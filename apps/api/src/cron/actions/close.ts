import { eq } from 'drizzle-orm'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { emitIssueUpdated } from '@/events/issue-events'
import { registerIssueAction } from './registry'
import type { IssueActionContext } from './types'

async function handleClose(ctx: IssueActionContext): Promise<string> {
  const { project, issue } = ctx
  const targetStatus = (ctx.config.targetStatus as string) ?? 'done'

  if (issue.statusId === targetStatus) {
    return `issue ${issue.id} already in ${targetStatus} status`
  }

  // Cancel active session if running
  if (issue.sessionStatus === 'running' || issue.sessionStatus === 'pending') {
    await issueEngine.cancelIssue(issue.id)
  }

  db.update(issuesTable)
    .set({ statusId: targetStatus, statusUpdatedAt: new Date() })
    .where(eq(issuesTable.id, issue.id))
    .run()

  await cacheDel(`issue:${project.id}:${issue.id}`)
  emitIssueUpdated(issue.id, { statusId: targetStatus })

  return `issue ${issue.id} moved to ${targetStatus}`
}

registerIssueAction('close', {
  description: 'Move an issue to done (or specified targetStatus), cancelling any active session',
  handler: handleClose,
})
