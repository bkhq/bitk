import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'

/**
 * Resolve project + issue from config.
 * Shared by all issue-category actions.
 */
export async function resolveIssue(config: Record<string, unknown>) {
  const { projectId, issueId } = config
  if (!projectId) throw new Error('taskConfig.projectId is required')
  if (!issueId) throw new Error('taskConfig.issueId is required')

  const project = await findProject(projectId as string)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const [issue] = db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, issueId as string),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )
    .all()
  if (!issue) throw new Error(`Issue not found: ${issueId}`)

  return { project, issue }
}

/**
 * Validate that projectId + issueId exist.
 * Used as ActionDef.validate at cron-create time.
 */
export async function validateIssueRefs(config: Record<string, unknown>): Promise<string | null> {
  try {
    await resolveIssue(config)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
