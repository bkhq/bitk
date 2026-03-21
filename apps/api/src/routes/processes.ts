import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'
import type { ProcessInfo } from '@bkd/shared'

export async function buildProcessInfoList(): Promise<ProcessInfo[]> {
  const activeProcesses = issueEngine.getActiveProcesses()
  const issueIds = activeProcesses.map(p => p.issueId)
  if (issueIds.length === 0) return []

  const matchedIssues = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.isDeleted, 0),
        inArray(issuesTable.id, issueIds),
      ),
    )

  if (matchedIssues.length === 0) return []

  const projectIds = [...new Set(matchedIssues.map(i => i.projectId))]
  const projects = await db
    .select({ id: projectsTable.id, alias: projectsTable.alias, name: projectsTable.name })
    .from(projectsTable)
    .where(
      and(
        inArray(projectsTable.id, projectIds),
        eq(projectsTable.isDeleted, 0),
      ),
    )
  const projectMap = new Map(projects.map(p => [p.id, { alias: p.alias, name: p.name }]))

  const issueMap = new Map(matchedIssues.map(i => [i.id, i]))
  const result: ProcessInfo[] = []

  for (const p of activeProcesses) {
    const issue = issueMap.get(p.issueId)
    if (!issue) continue
    result.push({
      executionId: p.executionId,
      issueId: p.issueId,
      issueTitle: issue.title,
      issueNumber: issue.issueNumber,
      projectId: issue.projectId,
      projectAlias: projectMap.get(issue.projectId)?.alias ?? '',
      projectName: projectMap.get(issue.projectId)?.name ?? '',
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

  return result
}

const processes = new Hono()

processes.get('/', async (c) => {
  const result = await buildProcessInfoList()
  return c.json({ success: true, data: { processes: result } })
})

processes.post('/:issueId/terminate', async (c) => {
  const issueId = c.req.param('issueId')!

  // Verify issue exists and its project is not deleted
  const [issue] = await db
    .select({ id: issuesTable.id, projectId: issuesTable.projectId })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.isDeleted, 0),
        eq(projectsTable.isDeleted, 0),
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
