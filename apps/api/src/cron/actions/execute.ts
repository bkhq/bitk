import { issueEngine } from '@/engines/issue'
import type { EngineType } from '@/engines/types'
import { ensureWorking, parseProjectEnvVars } from '@/routes/issues/_shared'
import { registerIssueAction } from './registry'
import type { IssueActionContext } from './types'

async function handleExecute(ctx: IssueActionContext): Promise<string> {
  const { project, issue, config } = ctx
  const prompt = config.prompt as string

  const guard = await ensureWorking(issue)
  if (!guard.ok) throw new Error(guard.reason!)

  const engineType = ((config.engineType as string) ?? issue.engineType ?? 'claude-code') as EngineType
  const basePrompt = project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt
  const envVars = parseProjectEnvVars(project.envVars)

  const result = await issueEngine.executeIssue(issue.id, {
    engineType,
    prompt: basePrompt,
    workingDir: project.directory || undefined,
    model: (config.model as string) ?? issue.model ?? undefined,
    envVars,
  })

  return `execution started for issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
}

registerIssueAction('execute', {
  description: 'Start AI engine execution on an issue',
  requiredFields: ['prompt'],
  handler: handleExecute,
})
