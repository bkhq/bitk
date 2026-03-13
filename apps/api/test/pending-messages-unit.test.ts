import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  deletePendingMessage,
  getPendingMessage,
  getPendingMessageById,
  getPendingMessages,
  markPendingMessagesDispatched,
  relocatePendingForProcessing,
  restorePendingVisibility,
  upsertPendingMessage,
} from '@/db/pending-messages'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import './setup'

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
      sortOrder: 0,
      engineType: 'echo',
      model: 'auto',
      prompt: 'test',
    })
    .returning()
  return row!
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

describe('pending message storage', () => {
  test('stores multiple pending rows independently', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    expect(firstId).not.toBe(secondId)

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(2)
    expect(pending.map(row => row.id)).toEqual([firstId, secondId])
    expect(pending.map(row => row.content)).toEqual(['first pending', 'second pending'])
  })

  test('preserves non-pending queued types when inserting', async () => {
    const issue = await createTestIssue()

    const messageId = await upsertPendingMessage(issue.id, 'done message', { type: 'done' })
    const [row] = await db
      .select({ metadata: issueLogs.metadata })
      .from(issueLogs)
      .where(eq(issueLogs.id, messageId))

    expect(row).toBeTruthy()
    expect(JSON.parse(row!.metadata!)).toEqual({ type: 'done' })
    const queued = await getPendingMessages(issue.id)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.id).toBe(messageId)
  })

  test('getPendingMessage returns the oldest visible pending row', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const oldest = await getPendingMessage(issue.id)
    expect(oldest?.id).toBe(firstId)
    expect(oldest?.content).toBe('first pending')
  })

  test('getPendingMessageById returns visible queueable rows only', async () => {
    const issue = await createTestIssue()

    const pendingId = await upsertPendingMessage(issue.id, 'visible pending', { type: 'pending' })
    const doneId = await upsertPendingMessage(issue.id, 'done row', { type: 'done' })

    expect((await getPendingMessageById(issue.id, pendingId))?.id).toBe(pendingId)
    expect((await getPendingMessageById(issue.id, doneId))?.id).toBe(doneId)
  })
})

describe('pending message recall', () => {
  test('deletes only the targeted pending row', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const recalled = await deletePendingMessage(issue.id, secondId)
    expect(recalled?.id).toBe(secondId)
    expect(recalled?.content).toBe('second pending')

    const remaining = await getPendingMessages(issue.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(firstId)
  })

  test('allows recalling a queued done message by messageId', async () => {
    const issue = await createTestIssue()
    const doneId = await upsertPendingMessage(issue.id, 'done recall', { type: 'done' })

    const recalled = await deletePendingMessage(issue.id, doneId)
    expect(recalled?.id).toBe(doneId)
    expect(recalled?.metadata).toEqual({ type: 'done' })
    expect(await getPendingMessages(issue.id)).toHaveLength(0)
  })
})

describe('pending message dispatch', () => {
  test('relocates one pending row at a time in chronological order', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const firstRelocated = await relocatePendingForProcessing(issue.id)
    expect(firstRelocated?.oldId).toBe(firstId)
    expect(firstRelocated?.prompt).toBe('first pending')

    let pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe(secondId)

    const secondRelocated = await relocatePendingForProcessing(issue.id)
    expect(secondRelocated?.oldId).toBe(secondId)
    expect(secondRelocated?.prompt).toBe('second pending')

    pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(0)
  })

  test('restorePendingVisibility makes a failed relocation retryable', async () => {
    const issue = await createTestIssue()
    const pendingId = await upsertPendingMessage(issue.id, 'retry me', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated?.oldId).toBe(pendingId)
    expect(await getPendingMessages(issue.id)).toHaveLength(0)

    restorePendingVisibility(pendingId)

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe(pendingId)
  })

  test('markPendingMessagesDispatched hides only the provided IDs', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    await markPendingMessagesDispatched([firstId])

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe(secondId)
  })
})
