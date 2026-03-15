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
  test('relocates all pending rows at once and merges prompts', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated?.oldIds).toEqual([firstId, secondId])
    expect(relocated?.prompt).toBe('first pending\n\nsecond pending')
    expect(relocated?.displayPrompt).toBe('first pending\n\nsecond pending')

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(0)

    // No more pending messages to relocate
    const empty = await relocatePendingForProcessing(issue.id)
    expect(empty).toBeNull()
  })

  test('merges attachments metadata from all pending messages', async () => {
    const issue = await createTestIssue()

    const att1 = { id: 'a1', name: 'file1.txt', mimeType: 'text/plain', size: 100 }
    const att2 = { id: 'a2', name: 'file2.png', mimeType: 'image/png', size: 200 }

    await upsertPendingMessage(issue.id, 'msg with file1', {
      type: 'pending',
      attachments: [att1],
    })
    await upsertPendingMessage(issue.id, 'msg with file2', {
      type: 'pending',
      attachments: [att2],
    })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated).not.toBeNull()
    expect(relocated!.metadata.attachments).toEqual([att1, att2])
    expect(relocated!.prompt).toBe('msg with file1\n\nmsg with file2')
  })

  test('merges metadata without attachments when none present', async () => {
    const issue = await createTestIssue()

    await upsertPendingMessage(issue.id, 'plain msg', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated).not.toBeNull()
    expect(relocated!.metadata.attachments).toBeUndefined()
  })

  test('restorePendingVisibility makes a failed relocation retryable', async () => {
    const issue = await createTestIssue()
    const pendingId = await upsertPendingMessage(issue.id, 'retry me', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated?.oldIds).toEqual([pendingId])
    expect(await getPendingMessages(issue.id)).toHaveLength(0)

    restorePendingVisibility(relocated!.oldIds)

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
