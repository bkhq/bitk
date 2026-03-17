import type { Context } from 'hono'
import { Hono } from 'hono'
import { findProject, getAppSetting } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { DEFAULT_LOG_PAGE_SIZE, LOG_PAGE_SIZE_KEY } from '@/engines/issue/constants'
import type { LogQueryOpts } from '@/engines/issue/persistence/queries'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

/** Allowed entry types that callers can filter by. */
const VALID_ENTRY_TYPES = new Set([
  'user-message',
  'assistant-message',
  'tool-use',
  'system-message',
  'thinking',
])

/** Allowed filter keys in the path. */
const VALID_FILTER_KEYS = new Set(['types', 'turn'])

/** Parse comma-separated entry types, return valid list or error string. */
function parseEntryTypes(raw: string): { types: string[] } | { error: string } {
  const requested = raw.split(',').map(s => s.trim()).filter(Boolean)
  const valid = requested.filter(t => VALID_ENTRY_TYPES.has(t))
  if (valid.length === 0) {
    return { error: `Invalid types. Allowed: ${[...VALID_ENTRY_TYPES].join(', ')}` }
  }
  return { types: valid }
}

/**
 * Parse turn value into a range { start, end }.
 *
 * Supported formats:
 *   "3"       → turn 3 only
 *   "2-5"     → turns 2 through 5
 *   "last"    → last turn only
 *   "last3"   → last 3 turns
 */
function parseTurn(raw: string, issueId: string): { start: number, end: number } | { error: string } {
  const maxTurn = issueEngine.getMaxTurnIndex(issueId)
  if (maxTurn < 0) {
    return { error: 'No turns exist for this issue' }
  }

  // "last" or "lastN" → last N turns (default N=1)
  const lastN = raw.match(/^last(\d+)?$/)
  if (lastN) {
    const n = lastN[1] ? Number(lastN[1]) : 1
    if (n <= 0) return { error: 'lastN must be a positive number' }
    return { start: Math.max(0, maxTurn - n + 1), end: maxTurn }
  }

  // "X-Y" → range
  const range = raw.match(/^(\d+)-(\d+)$/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (start > end) return { error: 'turn range start must be <= end' }
    return { start, end }
  }

  // single number
  const n = Math.floor(Number(raw))
  if (Number.isNaN(n) || n < 0) {
    return { error: 'turn must be a number, range (2-5), "last", or "lastN" (e.g. last3)' }
  }
  return { start: n, end: n }
}

/**
 * Parse filter path segments into a key-value map.
 * Path like "types/user-message,assistant-message/turn/last" becomes:
 *   { types: "user-message,assistant-message", turn: "last" }
 */
function parseFilterPath(raw: string): { filters: Record<string, string> } | { error: string } {
  const segments = raw.split('/').filter(Boolean)
  if (segments.length % 2 !== 0) {
    return { error: 'Filter path must be key/value pairs (e.g. /filter/types/user-message/turn/latest)' }
  }
  const filters: Record<string, string> = {}
  for (let i = 0; i < segments.length; i += 2) {
    const key = segments[i]
    const value = segments[i + 1]
    if (!VALID_FILTER_KEYS.has(key)) {
      return { error: `Unknown filter key "${key}". Allowed: ${[...VALID_FILTER_KEYS].join(', ')}` }
    }
    if (key in filters) {
      return { error: `Duplicate filter key "${key}"` }
    }
    try {
      filters[key] = decodeURIComponent(value)
    } catch {
      return { error: `Malformed percent-encoding in filter value for "${key}"` }
    }
  }
  return { filters }
}

/** Build LogQueryOpts from parsed filter map. */
function buildFilterOpts(filters: Record<string, string>, issueId: string): { opts: Partial<LogQueryOpts> } | { error: string } {
  const opts: Partial<LogQueryOpts> = {}

  if (filters.types) {
    const parsed = parseEntryTypes(filters.types)
    if ('error' in parsed) return parsed
    opts.entryTypes = parsed.types
  }

  if (filters.turn) {
    const parsed = parseTurn(filters.turn, issueId)
    if ('error' in parsed) return parsed

    // Turn range always sets turnIndex bounds
    opts.turnIndex = parsed.start
    opts.turnIndexEnd = parsed.end
  }

  return { opts }
}

/** Parse pagination query params. */
async function parsePagination(c: Context) {
  const cursor = c.req.query('cursor') || undefined
  const before = c.req.query('before') || undefined
  const limitParam = c.req.query('limit')

  let limit: number | undefined
  if (limitParam) {
    limit = Math.min(Math.max(Math.floor(Number(limitParam)) || 30, 1), 1000)
  } else {
    const pageSizeRaw = await getAppSetting(LOG_PAGE_SIZE_KEY)
    limit = pageSizeRaw ? Number(pageSizeRaw) || DEFAULT_LOG_PAGE_SIZE : DEFAULT_LOG_PAGE_SIZE
  }

  return { cursor, before, limit }
}

/** Execute log query and return JSON response. */
function queryAndRespond(c: Context, issue: Awaited<ReturnType<typeof getProjectOwnedIssue>>, issueId: string, opts: LogQueryOpts) {
  const result = issueEngine.getLogs(issueId, opts)
  const isReverse = !opts.cursor
  const cursorEntry = isReverse ? result.entries[0] : result.entries.at(-1)
  const nextCursor = result.hasMore && cursorEntry?.messageId ? cursorEntry.messageId : null

  return c.json({
    success: true,
    data: {
      issue: serializeIssue(issue!),
      logs: result.entries,
      nextCursor,
      hasMore: result.hasMore,
    },
  })
}

/** Validate project + issue ownership, return both or error response. */
async function resolveIssue(c: Context) {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return { error: c.json({ success: false, error: 'Project not found' }, 404) }
  }
  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return { error: c.json({ success: false, error: 'Issue not found' }, 404) }
  }
  return { issue, issueId }
}

const logs = new Hono()

// GET /:id/logs — All logs (default)
logs.get('/:id/logs', async (c) => {
  const resolved = await resolveIssue(c)
  if ('error' in resolved) return resolved.error
  const pagination = await parsePagination(c)
  return queryAndRespond(c, resolved.issue, resolved.issueId, pagination)
})

// GET /:id/logs/filter/* — Filtered logs with path-based key/value pairs
logs.get('/:id/logs/filter/*', async (c) => {
  const resolved = await resolveIssue(c)
  if ('error' in resolved) return resolved.error

  const filterPath = c.req.param('*')
  if (!filterPath) {
    // /logs/filter/ with nothing after → return all logs
    const pagination = await parsePagination(c)
    return queryAndRespond(c, resolved.issue, resolved.issueId, pagination)
  }

  const parsed = parseFilterPath(filterPath)
  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const filterOpts = buildFilterOpts(parsed.filters, resolved.issueId)
  if ('error' in filterOpts) {
    return c.json({ success: false, error: filterOpts.error }, 400)
  }

  const pagination = await parsePagination(c)
  return queryAndRespond(c, resolved.issue, resolved.issueId, {
    ...pagination,
    ...filterOpts.opts,
  })
})

export default logs
