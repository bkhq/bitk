import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'
import { toISO } from '@/utils/date'

const processes = new Hono()

processes.get('/', async (c) => {
  const projectId = c.req.param('projectId')
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const activeProcesses = issueEngine.getActiveProcesses()
  const issueIds = activeProcesses.map((p) => p.issueId)

  // Build result from in-memory active processes
  const result: Array<{
    executionId: string | null
    issueId: string
    issueTitle: string
    issueNumber: number
    engineType: string | null
    sessionStatus: string | null
    model: string | null
    startedAt: string | null
    turnInFlight: boolean
    spawnCommand: string | null
    lastIdleAt: string | null
    pid: number | null
  }> = []

  if (issueIds.length > 0) {
    const projectIssues = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
          inArray(issuesTable.id, issueIds),
        ),
      )

    const issueMap = new Map(projectIssues.map((i) => [i.id, i]))

    for (const p of activeProcesses) {
      const issue = issueMap.get(p.issueId)
      if (!issue) continue
      result.push({
        executionId: p.executionId,
        issueId: p.issueId,
        issueTitle: issue.title,
        issueNumber: issue.issueNumber,
        engineType: issue.engineType ?? null,
        sessionStatus: issue.sessionStatus ?? null,
        model: issue.model ?? null,
        startedAt: p.startedAt.toISOString(),
        turnInFlight: p.turnInFlight,
        spawnCommand: p.spawnCommand ?? null,
        lastIdleAt: p.lastIdleAt?.toISOString() ?? null,
        pid: getPidFromManaged(p) ?? null,
      })
    }
  }

  // Also include DB-only running/pending issues (no active process — stale)
  const activeIssueIds = new Set(result.map((r) => r.issueId))
  const dbOnlyIssues = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
        inArray(issuesTable.sessionStatus, ['running', 'pending']),
      ),
    )

  for (const issue of dbOnlyIssues) {
    if (activeIssueIds.has(issue.id)) continue
    result.push({
      executionId: null,
      issueId: issue.id,
      issueTitle: issue.title,
      issueNumber: issue.issueNumber,
      engineType: issue.engineType ?? null,
      sessionStatus: issue.sessionStatus ?? null,
      model: issue.model ?? null,
      startedAt: toISO(issue.updatedAt),
      turnInFlight: false,
      spawnCommand: null,
      lastIdleAt: null,
      pid: null,
    })
  }

  return c.json({ success: true, data: { processes: result } })
})

// POST /api/projects/:projectId/processes/:issueId/terminate
processes.post('/:issueId/terminate', async (c) => {
  const projectId = c.req.param('projectId')
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('issueId')!
  const [issue] = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )

  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  try {
    await issueEngine.terminateProcess(issueId)
    return c.json({ success: true, data: { issueId, status: 'terminated' } })
  } catch (error) {
    logger.error({ issueId, error }, 'terminate_process_failed')
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Terminate failed',
      },
      400,
    )
  }
})

export default processes
