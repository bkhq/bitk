import { issueEngine } from '@/engines/issue'
import type { EngineType } from '@/engines/types'
import { ensureWorking, parseProjectEnvVars } from '@/routes/issues/_shared'
import { registerAction } from '../registry'
import { resolveIssue } from './resolver'

registerAction('issue-execute', {
  description: 'Start AI engine execution on an issue',
  category: 'issue',
  requiredFields: ['projectId', 'issueId', 'prompt'],
  async handler(config) {
    const { project, issue } = await resolveIssue(config)
    const prompt = config.prompt as string

    // Skip if issue already has an active session
    if (issue.sessionStatus === 'running' || issue.sessionStatus === 'pending') {
      return `skipped: issue ${issue.id} already has active session (${issue.sessionStatus})`
    }

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
  },
})
