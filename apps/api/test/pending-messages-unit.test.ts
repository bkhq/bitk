import { beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@/db'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
// We import the shared helpers directly
import { getPendingMessages, markPendingMessagesDispatched } from '@/routes/issues/_shared'

/**
 * Pending messages unit tests — tests the low-level pending message
 * functions directly against the DB, verifying:
 * 1. getPendingMessages returns only pending=true messages
 * 2. markPendingMessagesDispatched marks entries as pending=false
 * 3. After marking dispatched, getPendingMessages returns empty
 * 4. collectPendingMessages-style merge works correctly
 *
 * These test the functions exported from _shared.ts and imported via
 * session.ts route module.
 */
import './setup'

// ---------- Test setup ----------

let projectId: string
let issueCounter = 0

async function createTestIssue(title?: string) {
  issueCounter++
  const [row] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'todo',
      issueNumber: issueCounter,
      title: title ?? `Pending Test Issue ${issueCounter}`,
      priority: 'medium',
      sortOrder: 0,
      engineType: 'echo',
      model: 'auto',
      prompt: 'test',
    })
    .returning()
  return row!
}

/**
 * Insert a pending message directly in the DB (equivalent to what
 * persistPendingMessage in session.ts does).
 */
async function insertPendingMessage(issueId: string, content: string) {
  await db.insert(issueLogs).values({
    issueId,
    turnIndex: 0,
    entryIndex: Date.now(), // unique
    entryType: 'user-message',
    content,
    metadata: JSON.stringify({ type: 'pending' }),
    timestamp: new Date().toISOString(),
  })
}

/**
 * Insert a dispatched (non-pending) message directly in the DB.
 */
async function insertDispatchedMessage(issueId: string, content: string) {
  await db.insert(issueLogs).values({
    issueId,
    turnIndex: 0,
    entryIndex: Date.now(),
    entryType: 'user-message',
    content,
    metadata: JSON.stringify({ type: 'dispatched' }),
    timestamp: new Date().toISOString(),
  })
}

beforeAll(async () => {
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Pending Unit Test Project',
      alias: `pending-unit-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

// ============================
// getPendingMessages
// ============================

describe('getPendingMessages', () => {
  test('returns pending messages for an issue', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'hello pending')
    await insertPendingMessage(issue.id, 'another pending')

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(2)
    expect(pending[0]!.content).toBe('hello pending')
    expect(pending[1]!.content).toBe('another pending')
  })

  test('returns only messages with metadata.type=pending', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'pending one')
    await insertDispatchedMessage(issue.id, 'dispatched one')
    await insertPendingMessage(issue.id, 'pending two')

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(2)
    expect(pending.map((m) => m.content)).toEqual(['pending one', 'pending two'])
  })

  test('returns empty array when no pending messages exist', async () => {
    const issue = await createTestIssue()

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(0)
  })

  test('does not return messages with null metadata', async () => {
    const issue = await createTestIssue()
    // Insert a message with no metadata
    await db.insert(issueLogs).values({
      issueId: issue.id,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'user-message',
      content: 'no metadata',
      metadata: null,
      timestamp: new Date().toISOString(),
    })

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(0)
  })

  test('does not return non-user-message entries even with pending metadata', async () => {
    const issue = await createTestIssue()
    // Insert a system message with pending=true (should not happen, but test the filter)
    await db.insert(issueLogs).values({
      issueId: issue.id,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'system-message',
      content: 'system with pending',
      metadata: JSON.stringify({ type: 'pending' }),
      timestamp: new Date().toISOString(),
    })

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(0)
  })

  test('does not return messages from a different issue', async () => {
    const issue1 = await createTestIssue()
    const issue2 = await createTestIssue()
    await insertPendingMessage(issue1.id, 'for issue 1')
    await insertPendingMessage(issue2.id, 'for issue 2')

    const pending1 = await getPendingMessages(issue1.id)
    expect(pending1.length).toBe(1)
    expect(pending1[0]!.content).toBe('for issue 1')

    const pending2 = await getPendingMessages(issue2.id)
    expect(pending2.length).toBe(1)
    expect(pending2[0]!.content).toBe('for issue 2')
  })
})

// ============================
// markPendingMessagesDispatched
// ============================

describe('markPendingMessagesDispatched', () => {
  test('marks specified pending messages as dispatched', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'to dispatch')
    await insertPendingMessage(issue.id, 'to keep pending')

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(2)

    // Mark only the first one as dispatched
    await markPendingMessagesDispatched([pending[0]!.id])

    const remaining = await getPendingMessages(issue.id)
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.content).toBe('to keep pending')
  })

  test('marks all pending messages as dispatched when given all IDs', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'msg 1')
    await insertPendingMessage(issue.id, 'msg 2')
    await insertPendingMessage(issue.id, 'msg 3')

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(3)

    await markPendingMessagesDispatched(pending.map((m) => m.id))

    const after = await getPendingMessages(issue.id)
    expect(after.length).toBe(0)
  })

  test('does nothing when given empty array', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'should remain')

    await markPendingMessagesDispatched([])

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(1)
  })

  test('after marking dispatched, getPendingMessages returns empty', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'lifecycle test')

    let pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(1)

    await markPendingMessagesDispatched(pending.map((m) => m.id))

    pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(0)
  })
})

// ============================
// Pending message lifecycle
// ============================

describe('Pending message lifecycle', () => {
  test('full lifecycle: insert -> get -> mark dispatched -> verify empty', async () => {
    const issue = await createTestIssue()

    // 1. Insert multiple pending messages
    await insertPendingMessage(issue.id, 'first message')
    await insertPendingMessage(issue.id, 'second message')
    await insertPendingMessage(issue.id, 'third message')

    // 2. Get pending messages
    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(3)

    // 3. Merge into a prompt (simulates collectPendingMessages logic)
    const basePrompt = 'base instruction'
    const merged = [basePrompt, ...pending.map((m) => m.content)].filter(Boolean).join('\n\n')
    expect(merged).toBe('base instruction\n\nfirst message\n\nsecond message\n\nthird message')

    // 4. Mark as dispatched after successful dispatch
    await markPendingMessagesDispatched(pending.map((m) => m.id))

    // 5. Verify no pending messages remain
    const after = await getPendingMessages(issue.id)
    expect(after.length).toBe(0)
  })

  test('pending messages preserve content after metadata parsing', async () => {
    const issue = await createTestIssue()
    const specialContent = 'message with "quotes" and\nnewlines\tand\ttabs'
    await insertPendingMessage(issue.id, specialContent)

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(1)
    expect(pending[0]!.content).toBe(specialContent)

    // Verify the metadata is valid JSON with pending=true
    const metadata = JSON.parse(pending[0]!.metadata!)
    expect(metadata.type).toBe('pending')
  })

  test('collectPendingMessages-style merge with empty base prompt', async () => {
    const issue = await createTestIssue()
    await insertPendingMessage(issue.id, 'only message')

    const pending = await getPendingMessages(issue.id)
    const merged = ['', ...pending.map((m) => m.content)].filter(Boolean).join('\n\n')
    expect(merged).toBe('only message')
  })

  test('collectPendingMessages-style merge returns base when no pending', async () => {
    const issue = await createTestIssue()

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBe(0)

    const basePrompt = 'just the base'
    const merged =
      pending.length === 0
        ? basePrompt
        : [basePrompt, ...pending.map((m) => m.content)].filter(Boolean).join('\n\n')
    expect(merged).toBe('just the base')
  })
})
