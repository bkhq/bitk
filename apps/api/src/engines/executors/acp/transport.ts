import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { safeEnv } from '@/engines/safe-env'
import type { StdinWriter, Subprocess } from '@/engines/spawn'
import type { AcpEvent, EventSink } from './types'

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGINT: 2,
  SIGKILL: 9,
  SIGTERM: 15,
}

export function createEventSink(): EventSink {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      closed = true
      controller = null
    },
  })

  return {
    stream,
    emit(event: AcpEvent) {
      if (closed || !controller) return
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    },
    close() {
      if (closed) return
      closed = true
      controller?.close()
      controller = null
    },
  }
}

export function createSubprocessFromChild(
  child: ChildProcessWithoutNullStreams,
  detached = true,
): Subprocess {
  const stdin: StdinWriter = {
    write(data) {
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
      // Node streams auto-flush.
    },
  }

  const exited = new Promise<number>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code !== null) {
        resolve(code)
        return
      }
      if (signal) {
        resolve(128 + (SIGNAL_NUMBERS[signal] ?? 15))
        return
      }
      resolve(1)
    })
    child.on('error', reject)
  })

  return {
    pid: child.pid,
    stdin,
    stdout: Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array>,
    exited,
    kill(signal?: number) {
      const pid = child.pid
      if (pid && detached) {
        try {
          process.kill(-pid, signal ?? 9)
          return
        } catch {
          // Fall through to direct child kill.
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

export function spawnAcpChild(
  cmd: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): ChildProcessWithoutNullStreams {
  const [program, ...args] = cmd
  return nodeSpawn(program!, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: safeEnv(extraEnv),
    detached: true,
  })
}
