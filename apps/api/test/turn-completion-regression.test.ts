import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { getPendingMessages } from '@/db/pending-messages'
import {
  issueLogs as issueLogsTable,
  issues as issuesTable,
  projects as projectsTable,
} from '@/db/schema'
import type { EngineContext } from '@/engines/issue/context'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { ExecutionStore } from '@/engines/issue/store/execution-store'
import type { ManagedProcess } from '@/engines/issue/types'
import { waitFor } from './helpers'
import './setup'

let projectId: string

beforeAll(async () => {
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Turn Completion Regression Project',
      alias: `turn-completion-reg-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

async function createWorkingIssue(title: string) {
  const [maxRow] = await db.select({ maxNum: db.$count(issuesTable) }).from(issuesTable)
  const issueNumber = (maxRow?.maxNum ?? 0) + 1

  const [issue] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'working',
      issueNumber,
      title,
      engineType: 'codex',
      sessionStatus: 'running',
      prompt: title,
      externalSessionId: `sess-${Date.now()}`,
      model: 'auto',
    })
    .returning()
  return issue!
}

async function insertPendingMessage(issueId: string, content: string) {
  await db.insert(issueLogsTable).values({
    issueId,
    turnIndex: 0,
    entryIndex: 0,
    entryType: 'user-message',
    content,
    metadata: JSON.stringify({ type: 'pending' }),
    visible: 1,
  })
}

describe('turn completion pending-flush regression', () => {
  test('failed auto-flush keeps DB pending rows for retry', async () => {
    const issue = await createWorkingIssue(`turn-completion-pending-${Date.now()}`)
    const pendingPrompt = `pending-msg-${Date.now()}`
    await insertPendingMessage(issue.id, pendingPrompt)

    const executionId = `exec-${Date.now()}`
    const managed: ManagedProcess = {
      executionId,
      issueId: issue.id,
      engineType: 'codex',
      process: {
        subprocess: { exited: Promise.resolve(0) },
      } as any,
      state: 'running',
      startedAt: new Date(),
      logs: new ExecutionStore(executionId),
      retryCount: 0,
      turnInFlight: true,
      queueCancelRequested: false,
      logicalFailure: false,
      turnSettled: false,
      metaTurn: false,
      slashCommands: [],
      agents: [],
      plugins: [],
      keepAlive: false,
      lastActivityAt: new Date(),
      pendingInputs: [],
    }

    const ctx: EngineContext = {
      pm: {
        get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
        getActive: () => [],
      } as any,
      issueOpLocks: new Map(),
      entryCounters: new Map(),
      turnIndexes: new Map(),
      userMessageIds: new Map(),
      lastErrors: new Map(),
      lockDepth: new Map(),
      followUpIssue: async () => {
        throw new Error('forced auto-flush follow-up failure')
      },
    }

    handleTurnCompleted(ctx, issue.id, executionId)

    await waitFor(async () => {
      const [row] = await db
        .select({ statusId: issuesTable.statusId })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))
      return row?.statusId === 'review'
    }, 5000)

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBeGreaterThanOrEqual(1)
    expect(pending.some(p => p.content === pendingPrompt)).toBe(true)
  })
})
