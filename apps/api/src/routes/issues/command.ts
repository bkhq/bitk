import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findProject, getAppSetting } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import {
  ensureWorking,
  getProjectOwnedIssue,
  normalizePrompt,
  parseProjectEnvVars,
} from './_shared'

const command = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:issueId/execute — Execute engine on issue
command.openapi(R.executeIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  const body = c.req.valid('json')
  const prompt = normalizePrompt(body.prompt)
  if (!prompt) {
    return c.json({ success: false, error: 'Prompt is required' }, 400 as const)
  }

  // Resolve workingDir from project.directory
  const workingDir = project.directory || undefined

  // Ensure workingDir exists and is within the configured workspace root.
  let effectiveWorkingDir: string | undefined
  if (workingDir) {
    const resolvedDir = resolve(workingDir)

    // SEC-016: Validate directory is within workspace root
    const workspaceRoot = await getAppSetting('workspace:defaultPath')
    if (workspaceRoot && workspaceRoot !== '/') {
      const resolvedRoot = resolve(workspaceRoot)
      if (!resolvedDir.startsWith(`${resolvedRoot}/`) && resolvedDir !== resolvedRoot) {
        return c.json(
          {
            success: false,
            error: 'Project directory is outside the configured workspace',
          },
          403 as const,
        )
      }
    }

    try {
      await mkdir(resolvedDir, { recursive: true })
    } catch {
      return c.json(
        {
          success: false,
          error: `Failed to create project directory: ${resolvedDir}`,
        },
        400 as const,
      )
    }

    try {
      const s = await stat(resolvedDir)
      if (!s.isDirectory()) {
        return c.json({ success: false, error: 'Project directory is not a directory' }, 400 as const)
      }
    } catch {
      return c.json(
        {
          success: false,
          error: `Project directory is unavailable: ${resolvedDir}`,
        },
        400 as const,
      )
    }
    effectiveWorkingDir = resolvedDir
  }

  try {
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return c.json({ success: false, error: guard.reason! }, 400 as const)
    }
    // Prepend project-level system prompt if configured
    const basePrompt = project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt
    const envVars = parseProjectEnvVars(project.envVars)
    const result = await issueEngine.executeIssue(issueId, {
      engineType: body.engineType as import('@/engines/types').EngineType,
      prompt: basePrompt,
      workingDir: effectiveWorkingDir,
      model: body.model,
      permissionMode: body.permissionMode,
      envVars,
    })
    return c.json({
      success: true,
      data: {
        executionId: result.executionId,
        issueId,
        messageId: result.messageId,
      },
    }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        model: body.model,
        permissionMode: body.permissionMode,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_followup_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/restart — Restart a failed issue session
command.openapi(R.restartIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  try {
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return c.json({ success: false, error: guard.reason! }, 400 as const)
    }
    const result = await issueEngine.restartIssue(issueId)
    return c.json({
      success: true,
      data: { executionId: result.executionId, issueId },
    }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_restart_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/cancel — Cancel
command.openapi(R.cancelIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  try {
    const status = await issueEngine.cancelIssue(issueId)
    return c.json({ success: true, data: { issueId, status } }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_cancel_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// GET /api/projects/:projectId/issues/:issueId/slash-commands — Get available slash commands
command.openapi(R.getSlashCommands, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  const engineType = (issue.engineType as import('@/engines/types').EngineType) ?? undefined
  const categorized = issueEngine.getCategorizedCommands(issueId, engineType)
  return c.json({ success: true, data: categorized }, 200 as const)
})

export default command
