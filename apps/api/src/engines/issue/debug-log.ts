import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT_DIR } from '@/root'

// ---------- Per-issue debug file logger ----------
// Writes raw process I/O and lifecycle events to data/logs/issues/<issueId>/
// Enabled when global LOG_LEVEL is 'debug' or 'trace'.

const ISSUE_LOG_DIR = join(ROOT_DIR, 'data', 'logs', 'issues')
const DEBUG_LEVELS = new Set(['debug', 'trace'])
const ENABLED = DEBUG_LEVELS.has(process.env.LOG_LEVEL ?? 'info')

/** No-op debug log returned when debug is disabled */
const NOOP_LOG: IssueDebugLog = {
  stdout() {},
  stderr() {},
  event() {},
} as IssueDebugLog

export class IssueDebugLog {
  private readonly filePath: string

  constructor(
    private readonly issueId: string,
    executionId: string,
  ) {
    const dir = join(ISSUE_LOG_DIR, issueId)
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'debug.log')
    this.write(
      `\n${'='.repeat(80)}\n[${ts()}] execution_start executionId=${executionId}\n`,
    )
  }

  stdout(line: string): void {
    this.write(`[${ts()}] [stdout] ${line}\n`)
  }

  stderr(line: string): void {
    this.write(`[${ts()}] [stderr] ${line}\n`)
  }

  event(msg: string): void {
    this.write(`[${ts()}] [event] ${msg}\n`)
  }

  private write(data: string): void {
    try {
      appendFileSync(this.filePath, data)
    } catch {
      // best-effort — don't crash the process
    }
  }
}

function ts(): string {
  return new Date().toISOString()
}

/** Create an IssueDebugLog if LOG_LEVEL=debug|trace, otherwise return a no-op. */
export function createIssueDebugLog(
  issueId: string,
  executionId: string,
): IssueDebugLog {
  if (!ENABLED) return NOOP_LOG
  return new IssueDebugLog(issueId, executionId)
}

/** Create a tee'd ReadableStream that writes each chunk to the debug log. */
export function teeStreamToDebug(
  stream: ReadableStream<Uint8Array>,
  log: IssueDebugLog,
  label: 'stdout' | 'stderr',
): ReadableStream<Uint8Array> {
  // If debug is disabled (no-op log), skip the tee overhead entirely
  if (log === NOOP_LOG) return stream

  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer) {
              if (label === 'stdout') log.stdout(buffer)
              else log.stderr(buffer)
            }
            controller.close()
            break
          }
          controller.enqueue(value)

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line) continue
            if (label === 'stdout') log.stdout(line)
            else log.stderr(line)
          }
        }
      } catch (err) {
        log.event(`${label}_stream_error: ${err}`)
        controller.error(err)
      }
    },
  })
}
