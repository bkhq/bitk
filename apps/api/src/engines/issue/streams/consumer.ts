import { setAppSetting } from '@/db/helpers'
import {
  refreshSlashCommandsCacheForEngine,
  slashCommandsKey,
} from '@/engines/issue/queries'
import type { ManagedProcess } from '@/engines/issue/types'
import { normalizeStream } from '@/engines/logs'
import type { EngineType, NormalizedLogEntry } from '@/engines/types'
import { isCancelledNoiseEntry, isTurnCompletionEntry } from './classification'

async function saveSlashCommandsToSettings(
  engineType: EngineType,
  commands: string[],
): Promise<void> {
  if (commands.length === 0) return
  await setAppSetting(slashCommandsKey(engineType), JSON.stringify(commands))
  await refreshSlashCommandsCacheForEngine(engineType)
}

export interface StreamCallbacks {
  getManaged: () => ManagedProcess | undefined
  getTurnIndex: () => number
  onEntry: (entry: NormalizedLogEntry) => void
  onTurnCompleted: () => void
  onStreamError: (error: unknown) => void
}

// ---------- Helpers ----------

function pushStderrEntry(
  content: string,
  turnIndex: number,
  onEntry: (entry: NormalizedLogEntry) => void,
): void {
  const entry: NormalizedLogEntry = {
    entryType: 'error-message',
    content,
    turnIndex,
    timestamp: new Date().toISOString(),
  }
  onEntry(entry)
}

// ---------- Stream consumers ----------

export async function consumeStream(
  _executionId: string,
  _issueId: string,
  stream: ReadableStream<Uint8Array>,
  parser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  callbacks: StreamCallbacks,
): Promise<void> {
  try {
    for await (const rawEntry of normalizeStream(stream, parser)) {
      const managed = callbacks.getManaged()
      if (!managed) break
      managed.lastActivityAt = new Date()
      const turnIdx = callbacks.getTurnIndex()

      const entry: NormalizedLogEntry = {
        ...rawEntry,
        turnIndex: turnIdx,
        timestamp: rawEntry.timestamp ?? new Date().toISOString(),
      }

      // Extract slash commands from SDK init message
      if (
        entry.entryType === 'system-message' &&
        entry.metadata?.subtype === 'init' &&
        Array.isArray(entry.metadata.slashCommands)
      ) {
        managed.slashCommands = entry.metadata.slashCommands as string[]
        void saveSlashCommandsToSettings(
          managed.engineType,
          managed.slashCommands,
        )
      }

      // Tag all entries in a meta turn so they are hidden from the frontend
      if (managed.metaTurn) {
        entry.metadata = { ...entry.metadata, type: 'system' }
      }

      // Claude may emit execution noise after interrupt (e.g. request aborted /
      // rust-analyzer crash). If this turn was user-cancelled, suppress it.
      if (managed.cancelledByUser && isCancelledNoiseEntry(entry)) {
        if (isTurnCompletionEntry(entry)) {
          callbacks.onTurnCompleted()
        }
        continue
      }

      callbacks.onEntry(entry)

      if (isTurnCompletionEntry(entry)) {
        callbacks.onTurnCompleted()
      }
    }
  } catch (error) {
    callbacks.onStreamError(error)
  }
}

export async function consumeStderr(
  _executionId: string,
  _issueId: string,
  stream: ReadableStream<Uint8Array>,
  callbacks: Pick<StreamCallbacks, 'getManaged' | 'getTurnIndex' | 'onEntry'>,
): Promise<void> {
  const reader = stream.getReader()
  try {
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const managed = callbacks.getManaged()
        if (!managed) return
        managed.lastActivityAt = new Date()
        pushStderrEntry(line, callbacks.getTurnIndex(), callbacks.onEntry)
      }
    }

    if (buffer.trim()) {
      const managed = callbacks.getManaged()
      if (managed) {
        pushStderrEntry(buffer, callbacks.getTurnIndex(), callbacks.onEntry)
      }
    }
  } catch {
    // Stderr stream closed or error — ignore
  } finally {
    reader.releaseLock()
  }
}
