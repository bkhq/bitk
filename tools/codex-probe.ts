#!/usr/bin/env bun
/**
 * codex-probe.ts — Start a Codex app-server process, send a file-editing prompt,
 * and capture all raw JSON-RPC notifications to study the exact structure of
 * patch_apply_begin / apply_patch_approval_request / fileChange events.
 *
 * Usage:
 *   bun scripts/codex-probe.ts [--prompt "your prompt"] [--cwd /path] [--timeout 60]
 *
 * Environment:
 *   OPENAI_API_KEY or CODEX_API_KEY must be set.
 *
 * Output:
 *   Prints every stdout line with classification. Writes a JSON array of all
 *   file-edit related events to scripts/codex-probe-output.json for analysis.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import * as path from 'node:path'
import * as fs from 'node:fs'

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2)

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const prompt = getArg(
  'prompt',
  'Create a file called /tmp/codex-probe-test.ts with a simple hello world function, then edit it to add a goodbye function.',
)
const cwd = getArg('cwd', '/tmp')
const timeoutSec = Number.parseInt(getArg('timeout', '120'), 10)
const model = getArg('model', '')

// ── Types ─────────────────────────────────────────────────

interface FileEditEvent {
  raw: string
  parsed: unknown
  classification: string
  timestamp: string
}

// ── State ─────────────────────────────────────────────────

const fileEditEvents: FileEditEvent[] = []
const allEvents: { method?: string, type?: string, line: string, timestamp: string }[] = []
let nextId = 1

// ── Helpers ───────────────────────────────────────────────

function log(tag: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23)
  const dataStr = data !== undefined ? ` ${JSON.stringify(data, null, 2)}` : ''
  console.log(`[${ts}] [${tag}] ${msg}${dataStr}`)
}

function writeJson(stdin: NodeJS.WritableStream, data: unknown) {
  const json = JSON.stringify(data)
  log('STDIN', json)
  stdin.write(`${json}\n`)
}

function sendRequest(stdin: NodeJS.WritableStream, method: string, params: Record<string, unknown>): number {
  const id = nextId++
  writeJson(stdin, { id, method, params })
  return id
}

function sendNotification(stdin: NodeJS.WritableStream, method: string, params?: Record<string, unknown>) {
  const msg: Record<string, unknown> = { method }
  if (params !== undefined) msg.params = params
  writeJson(stdin, msg)
}

function isFileEditRelated(line: string): boolean {
  return (
    line.includes('patch_apply')
    || line.includes('apply_patch')
    || line.includes('fileChange')
    || line.includes('file_change')
    || line.includes('"type":"fileChange"')
    || line.includes('file_edit')
    || line.includes('"Write"')
    || line.includes('"Edit"')
  )
}

function classifyLine(line: string): string {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line)
  } catch {
    return 'non-json'
  }

  const hasId = 'id' in parsed
  const hasMethod = typeof parsed.method === 'string'
  const hasResult = 'result' in parsed
  const hasError = 'error' in parsed

  if (hasId && (hasResult || hasError) && !hasMethod) return 'response'
  if (hasId && hasMethod) return 'server-request'
  if (hasMethod && !hasId) return 'notification'
  return 'unknown-json'
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  log('INFO', `Starting Codex app-server probe`)
  log('INFO', `Prompt: ${prompt}`)
  log('INFO', `CWD: ${cwd}`)
  log('INFO', `Timeout: ${timeoutSec}s`)
  log('INFO', `Model: ${model}`)

  // Ensure temp dir exists
  fs.mkdirSync(cwd, { recursive: true })

  const child = spawn('codex', ['app-server'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NPM_CONFIG_LOGLEVEL: 'error',
    },
  })

  log('INFO', `Spawned codex app-server, PID=${child.pid}`)

  const stdin = child.stdin!

  // Timeout kill
  const killTimer = setTimeout(() => {
    log('WARN', `Timeout reached (${timeoutSec}s), killing process`)
    try { child.kill() } catch { /* already dead */ }
  }, timeoutSec * 1000)

  // Collect stderr
  const stderrChunks: string[] = []
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderrChunks.push(text)
    for (const line of text.split('\n').filter(Boolean)) {
      log('STDERR', line)
    }
  })

  // State machine for handshake
  let state: 'init' | 'initialized' | 'account' | 'thread' | 'turn' | 'running' | 'done' = 'init'
  let threadId: string | undefined
  const pendingIds = new Map<number, string>() // id → method name

  // Process stdout line by line
  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      processLine(line)
    }
  })

  function processLine(line: string) {
    const ts = new Date().toISOString()
    const classification = classifyLine(line)

    // Log every line
    const shortLine = line.length > 500 ? `${line.slice(0, 500)}...[truncated:${line.length}]` : line
    log('STDOUT', `[${classification}] ${shortLine}`)

    // Track all events
    try {
      const parsed = JSON.parse(line)
      allEvents.push({ method: parsed.method, type: parsed.type, line, timestamp: ts })
    } catch {
      allEvents.push({ line, timestamp: ts })
    }

    // Capture file-edit related events with FULL content
    if (isFileEditRelated(line)) {
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { parsed = line }
      fileEditEvents.push({ raw: line, parsed, classification, timestamp: ts })
      log('FILE-EDIT', '>>> FILE EDIT EVENT CAPTURED <<<', parsed)
    }

    // Handle server requests (approvals)
    if (classification === 'server-request') {
      try {
        const parsed = JSON.parse(line)
        log('APPROVE', `Auto-approving server request: ${parsed.method}`)
        writeJson(stdin, { id: parsed.id, result: { decision: 'accept' } })
      } catch { /* ignore */ }
      return
    }

    // Handle responses to our requests
    if (classification === 'response') {
      try {
        const parsed = JSON.parse(line)
        const method = pendingIds.get(parsed.id)
        pendingIds.delete(parsed.id)

        if (parsed.error) {
          log('ERROR', `RPC error for ${method}: ${parsed.error.message}`)
          return
        }

        switch (state) {
          case 'init': {
            log('INFO', `Initialize response received`)
            state = 'initialized'
            sendNotification(stdin, 'initialized')

            // Send account/read
            state = 'account'
            const accId = sendRequest(stdin, 'account/read', { refreshToken: false })
            pendingIds.set(accId, 'account/read')
            break
          }
          case 'account': {
            log('INFO', `Account response`, parsed.result)
            state = 'thread'
            const threadParams: Record<string, unknown> = {
              cwd,
              approvalPolicy: 'never',
              sandbox: 'danger-full-access',
            }
            if (model) threadParams.model = model
            const thId = sendRequest(stdin, 'thread/start', threadParams)
            pendingIds.set(thId, 'thread/start')
            break
          }
          case 'thread': {
            const result = parsed.result as { thread?: { id?: string }, model?: string }
            threadId = result?.thread?.id
            log('INFO', `Thread started: ${threadId}, model: ${result?.model}`)
            state = 'turn'
            const turnId = sendRequest(stdin, 'turn/start', {
              threadId,
              input: [{ type: 'text', text: prompt }],
            })
            pendingIds.set(turnId, 'turn/start')
            break
          }
          case 'turn': {
            const result = parsed.result as { turn?: { id?: string } }
            log('INFO', `Turn started: ${result?.turn?.id}`)
            state = 'running'
            break
          }
        }
      } catch (err) {
        log('ERROR', `Failed to process response: ${err}`)
      }
      return
    }

    // Detect turn completion
    if (classification === 'notification') {
      try {
        const parsed = JSON.parse(line)
        if (
          parsed.method === 'turn/completed'
          || (parsed.method === 'codex/event/xxx' && parsed.params?.msg?.type === 'turn_complete')
        ) {
          log('INFO', '=== TURN COMPLETED ===')
          state = 'done'
          // Give a brief moment for any trailing events
          setTimeout(() => finish(), 2000)
        }
      } catch { /* ignore */ }
    }
  }

  function finish() {
    clearTimeout(killTimer)
    try { stdin.end() } catch { /* already closed */ }
    try { child.kill() } catch { /* already dead */ }

    const outputPath = path.join(path.dirname(import.meta.dir || '.'), 'scripts', 'codex-probe-output.json')
    const output = {
      prompt,
      model,
      cwd,
      timestamp: new Date().toISOString(),
      fileEditEvents,
      totalEvents: allEvents.length,
      allEventMethods: [...new Set(allEvents.map(e => e.method).filter(Boolean))],
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
    log('INFO', `Wrote ${fileEditEvents.length} file-edit events to ${outputPath}`)
    log('INFO', `Total events captured: ${allEvents.length}`)
    log('INFO', `Unique methods: ${output.allEventMethods.join(', ')}`)

    if (fileEditEvents.length === 0) {
      log('WARN', 'No file-edit events captured! Dumping all events...')
      const allOutputPath = path.join(path.dirname(import.meta.dir || '.'), 'scripts', 'codex-probe-all-events.json')
      fs.writeFileSync(allOutputPath, JSON.stringify(allEvents, null, 2))
      log('INFO', `Wrote all events to ${allOutputPath}`)
    }

    process.exit(0)
  }

  // Start handshake
  const initId = sendRequest(stdin, 'initialize', {
    clientInfo: { name: 'codex-probe', version: '0.1.0', title: 'Codex Probe' },
    capabilities: { experimental_api: true },
  })
  pendingIds.set(initId, 'initialize')

  // Handle process exit
  child.on('exit', (code, signal) => {
    log('INFO', `Process exited: code=${code}, signal=${signal}`)
    if (state !== 'done') {
      finish()
    }
  })

  child.on('error', (err) => {
    log('ERROR', `Process error: ${err.message}`)
    finish()
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
