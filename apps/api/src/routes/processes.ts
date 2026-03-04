import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'

const processes = new Hono()

processes.get('/', async (c) => {
  const projectId = c.req.param('projectId')
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const activeProcesses = issueEngine.getActiveProcesses()
  const issueIds = activeProcesses.map((p) => p.issueId)

  // Build result from in-memory active processes (PM is the source of truth)
  const result: Array<{
    executionId: string
    issueId: string
    issueTitle: string
    issueNumber: number
    engineType: string
    processState: string
    model: string | null
    startedAt: string
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
        engineType: p.engineType,
        processState: p.state,
        model: issue.model ?? null,
        startedAt: p.startedAt.toISOString(),
        turnInFlight: p.turnInFlight,
        spawnCommand: p.spawnCommand ?? null,
        lastIdleAt: p.lastIdleAt?.toISOString() ?? null,
        pid: getPidFromManaged(p) ?? null,
      })
    }
  }

  // Process state comes entirely from PM memory. DB-only stale entries
  // (running/pending with no active process) are cleaned by the reconciler.
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
        error: 'Failed to terminate process',
      },
      400,
    )
  }
})

export default processes
