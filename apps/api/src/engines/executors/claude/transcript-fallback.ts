import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isTurnCompletionEntry } from '@/engines/issue/streams/classification'
import type { NormalizedLogEntry } from '@/engines/types'
import { logger } from '@/logger'

// ---------- Transcript fallback ----------
//
// When stdout pipe breaks prematurely (Bun pipe bug or Claude CLI hook
// closing fd 1), the transcript JSONL file — written by Claude CLI via
// appendFileSync — continues to receive data.  This module reads the
// transcript, skips already-processed entries, and feeds missing entries
// through the same normalizer/callbacks pipeline.

/** Minimum fields we need from transcript JSONL entries. */
interface TranscriptEntry {
  type: string
  uuid?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
    id?: string
    stop_reason?: string | null
    usage?: Record<string, unknown>
  }
  subtype?: string
  session_id?: string
  sessionId?: string
}

/**
 * Construct the transcript JSONL path from CWD and session ID.
 * Claude CLI stores transcripts at:
 *   ~/.claude/projects/${cwd.replaceAll('/', '-')}/${sessionId}.jsonl
 */
export function getTranscriptPath(cwd: string, sessionId: string): string {
  const projectHash = cwd.replaceAll('/', '-')
  return join(homedir(), '.claude', 'projects', projectHash, `${sessionId}.jsonl`)
}

/**
 * Read transcript JSONL and return entries after `afterTimestamp`.
 * Returns entries converted to stream-json format lines that can be
 * fed through the existing ClaudeLogNormalizer.
 */
function readTranscriptAfter(transcriptPath: string, afterTimestamp: string): string[] {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf-8')
  } catch (err) {
    logger.warn({ transcriptPath, err }, 'transcript_fallback_read_failed')
    return []
  }

  const lines = raw.split('\n').filter((l) => l.trim())
  const outputLines: string[] = []

  for (const line of lines) {
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    // Skip entries at or before the cutoff timestamp
    if (!entry.timestamp || entry.timestamp <= afterTimestamp) continue

    // Convert transcript format to stream-json format for the normalizer
    const converted = convertToStreamJson(entry)
    if (converted) {
      outputLines.push(converted)
    }
  }

  return outputLines
}

/**
 * Convert a transcript JSONL entry to stream-json format.
 * The normalizer expects `{ type, message, session_id, uuid, ... }` lines.
 * Transcript entries are nearly identical — just need minor field mapping.
 */
function convertToStreamJson(entry: TranscriptEntry): string | null {
  // Transcript uses `sessionId`, stream-json uses `session_id`
  const sessionId = entry.session_id ?? entry.sessionId

  switch (entry.type) {
    case 'assistant':
    case 'user':
      // These types have the same structure in both formats
      if (!entry.message) return null
      return JSON.stringify({
        type: entry.type,
        message: entry.message,
        session_id: sessionId,
        uuid: entry.uuid,
      })

    case 'system':
      // system entries with subtype stop_hook_summary indicate turn end
      if (entry.subtype === 'stop_hook_summary') {
        // Synthesize a result entry to signal turn completion
        return JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: sessionId,
          uuid: entry.uuid,
        })
      }
      return null

    // Skip progress, queue-operation, last-prompt — not useful for log entries
    default:
      return null
  }
}

/**
 * Run the transcript fallback: read missed entries, parse them through
 * the normalizer, and call the same callbacks used by consumeStream.
 *
 * Returns true if a turn completion was detected (caller should settle).
 */
export function runTranscriptFallback(
  transcriptPath: string,
  afterTimestamp: string,
  parser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  onEntry: (entry: NormalizedLogEntry) => void,
): boolean {
  const lines = readTranscriptAfter(transcriptPath, afterTimestamp)
  if (lines.length === 0) return false

  logger.info(
    { transcriptPath, lineCount: lines.length, afterTimestamp },
    'transcript_fallback_processing',
  )

  let turnCompleted = false

  for (const line of lines) {
    try {
      const result = parser(line)
      if (!result) continue
      const entries = Array.isArray(result) ? result : [result]
      for (const entry of entries) {
        entry.timestamp = entry.timestamp ?? new Date().toISOString()
        onEntry(entry)
        if (isTurnCompletionEntry(entry)) {
          turnCompleted = true
        }
      }
    } catch (err) {
      logger.warn({ err, line: line.slice(0, 200) }, 'transcript_fallback_parse_error')
    }
  }

  return turnCompleted
}
