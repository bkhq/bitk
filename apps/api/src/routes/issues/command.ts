import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { findProject, getAppSetting } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import {
  collectPendingMessages,
  ensureWorking,
  executeIssueSchema,
  getProjectOwnedIssue,
  markPendingMessagesDispatched,
  normalizePrompt,
} from './_shared'

const command = new Hono()

// POST /api/projects/:projectId/issues/:id/execute — Execute engine on issue
command.post(
  '/:id/execute',
  zValidator('json', executeIssueSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map((i) => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const projectId = c.req.param('projectId')!
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }

    const issueId = c.req.param('id')!
    const issue = await getProjectOwnedIssue(project.id, issueId)
    if (!issue) {
      return c.json({ success: false, error: 'Issue not found' }, 404)
    }

    const body = c.req.valid('json')
    const prompt = normalizePrompt(body.prompt)
    if (!prompt) {
      return c.json({ success: false, error: 'Prompt is required' }, 400)
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
        if (
          !resolvedDir.startsWith(`${resolvedRoot}/`) &&
          resolvedDir !== resolvedRoot
        ) {
          return c.json(
            {
              success: false,
              error: 'Project directory is outside the configured workspace',
            },
            403,
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
          400,
        )
      }

      try {
        const s = await stat(resolvedDir)
        if (!s.isDirectory()) {
          return c.json(
            { success: false, error: 'Project directory is not a directory' },
            400,
          )
        }
      } catch {
        return c.json(
          {
            success: false,
            error: `Project directory is unavailable: ${resolvedDir}`,
          },
          400,
        )
      }
      effectiveWorkingDir = resolvedDir
    }

    try {
      const guard = await ensureWorking(issue)
      if (!guard.ok) {
        return c.json({ success: false, error: guard.reason! }, 400)
      }
      const { prompt: effectivePrompt, pendingIds } =
        await collectPendingMessages(issueId, prompt)
      const result = await issueEngine.executeIssue(issueId, {
        engineType: body.engineType,
        prompt: effectivePrompt,
        workingDir: effectiveWorkingDir,
        model: body.model,
        permissionMode: body.permissionMode,
      })
      await markPendingMessagesDispatched(pendingIds)
      return c.json({
        success: true,
        data: {
          executionId: result.executionId,
          issueId,
          messageId: result.messageId,
        },
      })
    } catch (error) {
      logger.warn(
        {
          projectId: project.id,
          issueId,
          model: body.model,
          permissionMode: body.permissionMode,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        },
        'issue_followup_failed',
      )
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Execution failed',
        },
        400,
      )
    }
  },
)

// POST /api/projects/:projectId/issues/:id/restart — Restart a failed issue session
command.post('/:id/restart', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  try {
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return c.json({ success: false, error: guard.reason! }, 400)
    }
    // Discard queued messages — restart means fresh start
    const { pendingIds } = await collectPendingMessages(issueId, '')
    await markPendingMessagesDispatched(pendingIds)
    const result = await issueEngine.restartIssue(issueId)
    return c.json({
      success: true,
      data: { executionId: result.executionId, issueId },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Restart failed',
      },
      400,
    )
  }
})

// POST /api/projects/:projectId/issues/:id/cancel — Cancel
command.post('/:id/cancel', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  try {
    const status = await issueEngine.cancelIssue(issueId)
    return c.json({ success: true, data: { issueId, status } })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Cancel failed',
      },
      400,
    )
  }
})

// GET /api/projects/:projectId/issues/:id/slash-commands — Get available slash commands
command.get('/:id/slash-commands', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  const commands = issueEngine.getSlashCommands(issueId)
  return c.json({ success: true, data: { commands } })
})

export default command
