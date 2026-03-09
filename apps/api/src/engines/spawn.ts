import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from 'node:child_process'
import { Readable } from 'node:stream'

// ---------- Generic Subprocess type ----------

/**
 * Generic subprocess interface replacing `import type { Subprocess } from 'bun'`.
 * Compatible with both Bun.spawn results and spawnNode() results.
 */
export interface Subprocess {
  readonly pid: number | undefined
  readonly stdin: StdinWriter
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  readonly kill: (signal?: number) => void
  /** Bun PTY terminal handle — only present for Bun.spawn with terminal option */
  readonly terminal?: {
    write: (data: string) => void
    resize: (cols: number, rows: number) => void
    close: () => void
  }
  /** Allow Bun.spawn to attach unref */
  unref?: () => void
}

// ---------- StdinWriter ----------

/**
 * Writable interface compatible with Bun's FileSink.
 * Used by protocol handlers to write JSON to stdin.
 */
export interface StdinWriter {
  write: (data: string | Uint8Array) => void
  end: () => void
  flush?: () => void
}

// ---------- Spawn options ----------

interface SpawnOptions {
  cwd?: string
  stdin?: 'pipe' | 'ignore'
  stdout?: 'pipe' | 'ignore'
  stderr?: 'pipe' | 'ignore'
  env?: Record<string, string | undefined>
  /** Create a new process group (default: true). Set false for simple utility commands. */
  detached?: boolean
}

// ---------- spawnNode ----------

/**
 * Spawn a child process using node:child_process instead of Bun.spawn.
 *
 * Returns an object compatible with the generic Subprocess interface so that
 * ProcessManager and other consumers work without changes.
 *
 * Motivation: Bun.spawn has a known stdout pipe breakage bug where the
 * pipe closes prematurely while the process is still alive. Node's
 * child_process.spawn uses battle-tested pipe handling.
 */
export function spawnNode(
  cmd: string[],
  options?: SpawnOptions,
): Subprocess {
  const [program, ...args] = cmd
  const child = nodeSpawn(program!, args, {
    cwd: options?.cwd,
    stdio: [
      options?.stdin ?? 'pipe',
      options?.stdout ?? 'pipe',
      options?.stderr ?? 'pipe',
    ],
    env: options?.env as NodeJS.ProcessEnv,
    // Create a new process group so that kill(-pid) terminates the entire
    // tree (engine + MCP servers + any other children) instead of only the
    // top-level process, which would orphan grandchildren.
    detached: options?.detached ?? true,
  })

  // Wrap stdin as StdinWriter (compatible with Bun FileSink interface)
  const stdin: StdinWriter = {
    write(data: string | Uint8Array) {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write(data)
      }
    },
    end() {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end()
      }
    },
    flush() {
      // Node streams auto-flush; no-op for compatibility
    },
  }

  // Convert Node Readable to Web ReadableStream
  const stdout = child.stdout
    ? nodeReadableToWebStream(child.stdout)
    : emptyReadableStream()

  const stderr = child.stderr
    ? nodeReadableToWebStream(child.stderr)
    : emptyReadableStream()

  // Create exited promise from exit event.
  // Preserve signal exit codes (128 + signal) for compatibility with
  // completion-monitor.ts which derives signal info from exitCode > 128.
  const exited = new Promise<number>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code !== null) {
        resolve(code)
      } else if (signal) {
        // Match Bun convention: signal-terminated → 128 + signal number
        const sigNum = SIGNAL_NUMBERS[signal] ?? 15
        resolve(128 + sigNum)
      } else {
        resolve(1)
      }
    })
    child.on('error', (err) => {
      reject(err)
    })
  })

  return {
    pid: child.pid,
    stdin,
    stdout,
    stderr,
    exited,
    kill(signal?: number) {
      // Kill the entire process group (negative PID) so that child processes
      // spawned by engine (MCP servers, tools, etc.) are also terminated.
      // Falls back to killing just the child if group kill fails.
      const pid = child.pid
      if (pid && (options?.detached ?? true)) {
        try {
          process.kill(-pid, signal ?? 9)
          return
        } catch {
          // Process group may already be dead, or OS doesn't support it
        }
      }
      try {
        child.kill(signal)
      } catch {
        // already dead
      }
    },
    unref() {
      child.unref()
    },
  }
}

// ---------- spawnNodeSync ----------

export interface SyncResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Synchronous spawn using node:child_process.spawnSync.
 * Replaces Bun.spawnSync for simple command executions.
 */
export function spawnNodeSync(
  cmd: string[],
  options?: { cwd?: string, env?: Record<string, string | undefined> },
): SyncResult {
  const [program, ...args] = cmd
  const result = nodeSpawnSync(program!, args, {
    cwd: options?.cwd,
    env: options?.env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// ---------- runCommand ----------

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Convenience wrapper: spawn, capture stdout (and stderr when piped), wait for exit.
 * Replaces the common pattern:
 *   const proc = Bun.spawn([...], { stdout: 'pipe', stderr: 'ignore' })
 *   const stdout = await new Response(proc.stdout).text()
 *   const code = await proc.exited
 */
export async function runCommand(
  cmd: string[],
  options?: {
    cwd?: string
    env?: Record<string, string | undefined>
    stderr?: 'pipe' | 'ignore'
    timeout?: number
  },
): Promise<CommandResult> {
  const [program, ...args] = cmd
  const pipeStderr = options?.stderr === 'pipe'
  const child = nodeSpawn(program!, args, {
    cwd: options?.cwd,
    stdio: ['ignore', 'pipe', pipeStderr ? 'pipe' : 'ignore'],
    env: options?.env as NodeJS.ProcessEnv,
  })

  // Kill the child if it exceeds the timeout deadline
  let killTimer: ReturnType<typeof setTimeout> | undefined
  if (options?.timeout) {
    killTimer = setTimeout(() => {
      try {
        child.kill()
      } catch { /* already dead */ }
    }, options.timeout)
  }

  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
  if (pipeStderr) {
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  }

  // Wait for 'close' (not 'exit') to ensure all stdio streams are fully drained
  const code = await new Promise<number>((resolve, reject) => {
    child.on('close', code => resolve(code ?? 1))
    child.on('error', reject)
  })

  if (killTimer) clearTimeout(killTimer)

  return {
    code,
    stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
    stderr: Buffer.concat(stderrChunks).toString('utf-8'),
  }
}

// ---------- resolveCommand ----------

const resolveCache = new Map<string, string | null>()

/**
 * Resolve a command name to its full path, replacing Bun.which().
 * Results are cached per-process since PATH rarely changes at runtime.
 */
export function resolveCommand(name: string): string | null {
  if (resolveCache.has(name)) return resolveCache.get(name)!
  const result = nodeSpawnSync('which', [name], {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })
  const resolved = result.status === 0 && result.stdout ? result.stdout.trim() : null
  resolveCache.set(name, resolved)
  return resolved
}

// ---------- Internal helpers ----------

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
}

function nodeReadableToWebStream(readable: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>
}

function emptyReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}
