import { spawn as nodeSpawn } from 'node:child_process'
import { Readable } from 'node:stream'

/**
 * Writable interface compatible with Bun's FileSink.
 * Used by ClaudeProtocolHandler to write JSON to stdin.
 */
export interface StdinWriter {
  write: (data: string | Uint8Array) => void
  end: () => void
  flush?: () => void
}

interface SpawnResult {
  pid: number | undefined
  stdin: StdinWriter
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: (signal?: number) => void
}

interface SpawnOptions {
  cwd?: string
  stdin?: 'pipe' | 'ignore'
  stdout?: 'pipe' | 'ignore'
  stderr?: 'pipe' | 'ignore'
  env?: Record<string, string | undefined>
}

/**
 * Spawn a child process using node:child_process instead of Bun.spawn.
 *
 * Returns an object compatible with Bun's Subprocess interface so that
 * ProcessManager and other consumers work without changes.
 *
 * Motivation: Bun.spawn has a known stdout pipe breakage bug where the
 * pipe closes prematurely while the process is still alive. Node's
 * child_process.spawn uses battle-tested pipe handling.
 */
export function spawnNode(
  cmd: string[],
  options?: SpawnOptions,
): SpawnResult {
  const [program, ...args] = cmd
  const child = nodeSpawn(program, args, {
    cwd: options?.cwd,
    stdio: [
      options?.stdin ?? 'pipe',
      options?.stdout ?? 'pipe',
      options?.stderr ?? 'pipe',
    ],
    env: options?.env as NodeJS.ProcessEnv,
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
      try {
        child.kill(signal)
      } catch {
        // already dead
      }
    },
  }
}

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
