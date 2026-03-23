import { registerIssueAction } from './registry'
import type { IssueActionContext } from './types'

async function handleCheckStatus(ctx: IssueActionContext): Promise<string> {
  const { issue } = ctx

  return JSON.stringify({
    issueId: issue.id,
    statusId: issue.statusId,
    sessionStatus: issue.sessionStatus,
    engineType: issue.engineType,
    model: issue.model,
    updatedAt: issue.updatedAt,
    statusUpdatedAt: issue.statusUpdatedAt,
  })
}

registerIssueAction('check-status', {
  description: 'Check current status of an issue (useful for monitoring)',
  handler: handleCheckStatus,
})
