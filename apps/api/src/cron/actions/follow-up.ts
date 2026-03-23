import { issueEngine } from '@/engines/issue'
import { ensureWorking } from '@/routes/issues/_shared'
import { registerIssueAction } from './registry'
import type { IssueActionContext } from './types'

async function handleFollowUp(ctx: IssueActionContext): Promise<string> {
  const { project, issue, config } = ctx
  const prompt = config.prompt as string

  const guard = await ensureWorking(issue)
  if (!guard.ok) throw new Error(guard.reason!)

  const result = await issueEngine.followUpIssue(
    issue.id,
    prompt,
    (config.model as string) ?? issue.model ?? undefined,
  )

  return `follow-up sent to issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
}

registerIssueAction('follow-up', {
  description: 'Send a follow-up message to an issue',
  requiredFields: ['prompt'],
  handler: handleFollowUp,
})
