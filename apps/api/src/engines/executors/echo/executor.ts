import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  SpawnedProcess,
  SpawnOptions,
} from '@/engines/types'

/**
 * Echo — a mock engine that is always available.
 * No real subprocess is spawned. It writes stream-json directly
 * into in-memory ReadableStreams, useful for UI dev and testing.
 */

const ECHO_MODELS: EngineModel[] = [
  { id: 'auto', name: 'Auto', isDefault: true },
]

const encoder = new TextEncoder()

function jsonLine(obj: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(obj)}\n`)
}

/** Build a mock SpawnedProcess that echoes the prompt back via in-memory streams. */
function createMockProcess(prompt: string): SpawnedProcess {
  const ts = () => new Date().toISOString()
  let cancelled = false
  let resolveExit: (code: number) => void
  const exitPromise = new Promise<number>((r) => {
    resolveExit = r
  })

  const stdout = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        jsonLine({
          type: 'system',
          message: 'Echo engine ready',
          timestamp: ts(),
        }),
      )

      await Bun.sleep(100)
      if (cancelled) {
        controller.close()
        resolveExit(1)
        return
      }

      controller.enqueue(
        jsonLine({
          type: 'assistant',
          message: {
            id: `echo-${Date.now()}`,
            content: [{ type: 'text', text: prompt }],
          },
          timestamp: ts(),
        }),
      )

      await Bun.sleep(50)

      controller.enqueue(
        jsonLine({
          type: 'result',
          result: prompt,
          session_id: `echo-${Date.now()}`,
          cost_usd: 0,
          input_tokens: prompt.length,
          output_tokens: prompt.length,
          duration_ms: 150,
          timestamp: ts(),
        }),
      )

      controller.close()
      resolveExit(0)
    },
  })

  const stderr = new ReadableStream<Uint8Array>({
    start(c) {
      c.close()
    },
  })

  const subprocess = {
    pid: 0,
    kill: () => {
      cancelled = true
      resolveExit(1)
    },
    exited: exitPromise,
  } as unknown as SpawnedProcess['subprocess']

  return {
    subprocess,
    stdout,
    stderr,
    cancel: () => {
      cancelled = true
      resolveExit(1)
    },
  }
}

export class EchoExecutor implements EngineExecutor {
  readonly engineType = 'echo' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = ['session-fork']

  async spawn(
    options: SpawnOptions,
    _env: ExecutionEnv,
  ): Promise<SpawnedProcess> {
    return createMockProcess(options.prompt)
  }

  async spawnFollowUp(
    options: FollowUpOptions,
    _env: ExecutionEnv,
  ): Promise<SpawnedProcess> {
    return createMockProcess(options.prompt)
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    spawnedProcess.cancel()
  }

  async getAvailability(): Promise<EngineAvailability> {
    return {
      engineType: 'echo',
      installed: true,
      version: '1.0.0',
      authStatus: 'authenticated',
    }
  }

  async getModels(): Promise<EngineModel[]> {
    return ECHO_MODELS
  }

  normalizeLog(rawLine: string): NormalizedLogEntry | null {
    try {
      const data = JSON.parse(rawLine)

      switch (data.type) {
        case 'assistant': {
          const content = extractText(data.message?.content)
          if (!content) return null
          return {
            entryType: 'assistant-message',
            content,
            timestamp: data.timestamp,
            metadata: { messageId: data.message?.id },
          }
        }
        case 'result': {
          return {
            entryType: 'assistant-message',
            content: typeof data.result === 'string' ? data.result : '',
            timestamp: data.timestamp,
            metadata: {
              source: 'result',
              turnCompleted: true,
              resultSubtype: data.subtype,
              isError: data.is_error,
              sessionId: data.session_id,
              costUsd: data.cost_usd,
              inputTokens: data.input_tokens,
              outputTokens: data.output_tokens,
              duration: data.duration_ms,
            },
          }
        }
        case 'system': {
          return {
            entryType: 'system-message',
            content: data.message ?? '',
            timestamp: data.timestamp,
          }
        }
        case 'error': {
          return {
            entryType: 'error-message',
            content: data.error?.message ?? data.message ?? 'Unknown error',
            timestamp: data.timestamp,
          }
        }
        default:
          return null
      }
    } catch {
      if (rawLine.trim()) {
        return { entryType: 'system-message', content: rawLine }
      }
      return null
    }
  }
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')
  }
  return null
}
