import { eq } from 'drizzle-orm'
import { cacheDel } from '@/cache'
import { STATUS_IDS } from '@/config'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { emitIssueUpdated } from '@/events/issue-events'
import { registerAction } from '../registry'
import { resolveIssue } from './resolver'

registerAction('issue-close', {
  description: 'Move an issue to done (or specified targetStatus), cancelling any active session',
  category: 'issue',
  requiredFields: ['projectId', 'issueId'],
  async handler(config) {
    const { project, issue } = await resolveIssue(config)
    const targetStatus = (config.targetStatus as string) ?? 'done'

    if (!STATUS_IDS.includes(targetStatus as any)) {
      throw new Error(`Invalid targetStatus: "${targetStatus}". Must be one of: ${STATUS_IDS.join(', ')}`)
    }

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
  },
})
