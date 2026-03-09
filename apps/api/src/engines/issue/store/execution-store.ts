import { Database } from 'bun:sqlite'
import type { NormalizedLogEntry, ToolDetail, ToolGroupItem } from '@bkd/shared'

interface EntryRow {
  idx: number
  message_id: string | null
  reply_to_message_id: string | null
  turn_index: number
  entry_type: string
  content: string
  metadata: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_kind: string | null
  is_result: number
  timestamp: string | null
}

// ---------- Helpers ----------

function entryToRow(entry: NormalizedLogEntry): Omit<EntryRow, 'idx'> {
  const detail = entry.toolDetail
  // Merge toolAction into metadata so it survives the round-trip
  let metadata = entry.metadata
  if (entry.toolAction && !metadata?.toolAction) {
    metadata = { ...metadata, toolAction: entry.toolAction }
  }
  return {
    message_id: entry.messageId ?? null,
    reply_to_message_id: entry.replyToMessageId ?? null,
    turn_index: entry.turnIndex ?? 0,
    entry_type: entry.entryType,
    content: entry.content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    tool_call_id: detail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined) ?? null,
    tool_name: detail?.toolName ?? (entry.metadata?.toolName as string | undefined) ?? null,
    tool_kind: detail?.kind ?? null,
    is_result:
      detail?.isResult || (entry.metadata?.isResult as boolean | undefined) === true ? 1 : 0,
    timestamp: entry.timestamp ?? null,
  }
}

function rowToEntry(row: EntryRow): NormalizedLogEntry {
  const entry: NormalizedLogEntry = {
    messageId: row.message_id ?? undefined,
    replyToMessageId: row.reply_to_message_id ?? undefined,
    turnIndex: row.turn_index,
    entryType: row.entry_type as NormalizedLogEntry['entryType'],
    content: row.content,
    timestamp: row.timestamp ?? undefined,
  }

  if (row.metadata) {
    try {
      entry.metadata = JSON.parse(row.metadata)
    }
    catch {
      // ignore malformed metadata
    }
  }

  if (row.tool_name || row.tool_kind) {
    entry.toolDetail = {
      kind: row.tool_kind ?? 'other',
      toolName: row.tool_name ?? 'unknown',
      toolCallId: row.tool_call_id ?? undefined,
      isResult: row.is_result === 1,
    } satisfies ToolDetail
  }

  // Reconstruct toolAction from metadata if present
  if (entry.metadata?.toolAction) {
    entry.toolAction = entry.metadata.toolAction as NormalizedLogEntry['toolAction']
  }

  return entry
}

// ---------- ExecutionStore ----------

/**
 * Per-execution in-memory SQLite store.
 *
 * Captures ALL normalized entries from engine stdout without filtering.
 * The RingBuffer currently used for in-memory logs (pipeline order 20)
 * will be replaced by this store.
 *
 * Lifecycle:
 *   - Created when executor.spawn() starts
 *   - Written to by each normalized entry (replaces ring-buffer push)
 *   - Read by MessageRebuilder to produce ChatMessage[]
 *   - Destroyed after execution settlement + grace period
 */
export class ExecutionStore {
  private db: Database
  private destroyed = false

  // Prepared statements — compiled once, reused on every call
  private insertStmt: ReturnType<Database['prepare']>
  private byTurnStmt: ReturnType<Database['prepare']>
  private allEntriesStmt: ReturnType<Database['prepare']>
  private toolActionsStmt: ReturnType<Database['prepare']>
  private toolResultsStmt: ReturnType<Database['prepare']>
  private resultByIdStmt: ReturnType<Database['prepare']>
  private toolStatsStmt: ReturnType<Database['prepare']>
  private countByTurnStmt: ReturnType<Database['prepare']>
  private totalCountStmt: ReturnType<Database['prepare']>
  private hasEntryStmt: ReturnType<Database['prepare']>

  constructor(readonly executionId: string) {
    this.db = new Database(':memory:')
    this.db.exec('PRAGMA journal_mode = OFF')
    this.db.exec('PRAGMA synchronous = OFF')
    this.db.exec(`
      CREATE TABLE entries (
        idx INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT,
        reply_to_message_id TEXT,
        turn_index INTEGER NOT NULL DEFAULT 0,
        entry_type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_kind TEXT,
        is_result INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT
      );
      CREATE INDEX idx_turn ON entries(turn_index);
      CREATE INDEX idx_tool_call ON entries(tool_call_id) WHERE tool_call_id IS NOT NULL;
      CREATE INDEX idx_type ON entries(entry_type);
    `)

    this.insertStmt = this.db.prepare(`
      INSERT INTO entries
        (message_id, reply_to_message_id, turn_index, entry_type, content,
         metadata, tool_call_id, tool_name, tool_kind, is_result, timestamp)
      VALUES
        ($message_id, $reply_to_message_id, $turn_index, $entry_type, $content,
         $metadata, $tool_call_id, $tool_name, $tool_kind, $is_result, $timestamp)
    `)
    this.byTurnStmt = this.db.prepare('SELECT * FROM entries WHERE turn_index = ? ORDER BY idx')
    this.allEntriesStmt = this.db.prepare('SELECT * FROM entries ORDER BY idx')
    this.toolActionsStmt = this.db.prepare(
      `SELECT * FROM entries
       WHERE turn_index = ? AND entry_type = 'tool-use' AND is_result = 0
       ORDER BY idx`,
    )
    this.toolResultsStmt = this.db.prepare(
      `SELECT * FROM entries
       WHERE turn_index = ? AND entry_type = 'tool-use' AND is_result = 1`,
    )
    this.resultByIdStmt = this.db.prepare(
      `SELECT * FROM entries
       WHERE tool_call_id = ? AND is_result = 1
       LIMIT 1`,
    )
    this.toolStatsStmt = this.db.prepare(
      `SELECT tool_kind, COUNT(*) as cnt
       FROM entries
       WHERE turn_index = ? AND entry_type = 'tool-use' AND is_result = 0
       GROUP BY tool_kind`,
    )
    this.countByTurnStmt = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM entries WHERE turn_index = ?',
    )
    this.totalCountStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM entries')
    this.hasEntryStmt = this.db.prepare('SELECT 1 FROM entries WHERE message_id = ? LIMIT 1')
  }

  /** Append a normalized entry. */
  append(entry: NormalizedLogEntry): void {
    if (this.destroyed) return
    const row = entryToRow(entry)
    this.insertStmt.run({
      $message_id: row.message_id,
      $reply_to_message_id: row.reply_to_message_id,
      $turn_index: row.turn_index,
      $entry_type: row.entry_type,
      $content: row.content,
      $metadata: row.metadata,
      $tool_call_id: row.tool_call_id,
      $tool_name: row.tool_name,
      $tool_kind: row.tool_kind,
      $is_result: row.is_result,
      $timestamp: row.timestamp,
    })
  }

  /** Get all entries for a given turn, ordered by insertion. */
  getByTurn(turnIndex: number): NormalizedLogEntry[] {
    if (this.destroyed) return []
    const rows = this.byTurnStmt.all(turnIndex) as EntryRow[]
    return rows.map(rowToEntry)
  }

  /** Get all entries across all turns, ordered by insertion. */
  getAllEntries(): NormalizedLogEntry[] {
    if (this.destroyed) return []
    const rows = this.allEntriesStmt.all() as EntryRow[]
    return rows.map(rowToEntry)
  }

  /**
   * Get tool call pairs for a given turn.
   * Pairs each tool invocation (isResult=false) with its matching result
   * (isResult=true, same toolCallId).
   */
  getToolPairs(turnIndex: number): ToolGroupItem[] {
    if (this.destroyed) return []

    const actions = this.toolActionsStmt.all(turnIndex) as EntryRow[]
    // Bulk-fetch all results for this turn and build a Map for O(1) lookup
    const resultRows = this.toolResultsStmt.all(turnIndex) as EntryRow[]
    const resultMap = new Map<string, EntryRow>()
    for (const row of resultRows) {
      if (row.tool_call_id) resultMap.set(row.tool_call_id, row)
    }

    return actions.map((actionRow) => {
      let result: NormalizedLogEntry | null = null
      if (actionRow.tool_call_id) {
        const resultRow = resultMap.get(actionRow.tool_call_id)
        if (resultRow) result = rowToEntry(resultRow)
      }
      return { action: rowToEntry(actionRow), result }
    })
  }

  /** Get a single result entry matching a toolCallId. */
  getResult(toolCallId: string): NormalizedLogEntry | null {
    if (this.destroyed || !toolCallId) return null
    const row = this.resultByIdStmt.get(toolCallId) as EntryRow | null
    return row ? rowToEntry(row) : null
  }

  /** Count tool calls by kind for a given turn. */
  getToolStats(turnIndex: number): Record<string, number> {
    if (this.destroyed) return {}
    const rows = this.toolStatsStmt.all(turnIndex) as Array<{
      tool_kind: string | null
      cnt: number
    }>
    const stats: Record<string, number> = {}
    for (const row of rows) {
      stats[row.tool_kind ?? 'other'] = row.cnt
    }
    return stats
  }

  /** Total entry count for a turn. */
  getEntryCount(turnIndex: number): number {
    if (this.destroyed) return 0
    const row = this.countByTurnStmt.get(turnIndex) as { cnt: number }
    return row.cnt
  }

  /** Total entry count across all turns. */
  get totalEntries(): number {
    if (this.destroyed) return 0
    const row = this.totalCountStmt.get() as { cnt: number }
    return row.cnt
  }

  /** Check if an entry with the given messageId exists. */
  hasEntry(messageId: string): boolean {
    if (this.destroyed || !messageId) return false
    const row = this.hasEntryStmt.get(messageId) as { 1: number } | null
    return row !== null
  }

  /**
   * RingBuffer-compatible interface: toArray() returns all entries.
   * This allows ExecutionStore to be used where RingBuffer was used
   * in queries.ts merge logic.
   */
  toArray(): NormalizedLogEntry[] {
    return this.getAllEntries()
  }

  /** RingBuffer-compatible: entry count. */
  get length(): number {
    return this.totalEntries
  }

  /** RingBuffer-compatible: append. */
  push(entry: NormalizedLogEntry): void {
    this.append(entry)
  }

  /** Destroy the in-memory database and release resources. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    try {
      this.db.close()
    }
    catch {
      // already closed
    }
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }
}
