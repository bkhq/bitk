import type { SavedFile } from '../../uploads'
import type { IssueRow } from './_shared'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../../db'
import { findProject, getAppSetting } from '../../db/helpers'
import { attachments, issueLogs, issues as issuesTable } from '../../db/schema'
import { issueEngine } from '../../engines/issue-engine'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'
import { saveUploadedFile, UPLOAD_DIR, validateFiles } from '../../uploads'
import {
  executeIssueSchema,
  followUpSchema,
  getPendingMessages,
  getProjectOwnedIssue,
  markPendingMessagesDispatched,
} from './_shared'

function normalizePrompt(input: string): string {
  return input.replace(/^(?:\\n|\s)+/g, '').replace(/(?:\\n|\s)+$/g, '')
}

async function persistPendingMessage(
  issueId: string,
  prompt: string,
  meta: Record<string, unknown> = { pending: true },
): Promise<string> {
  const { ulid } = await import('ulid')
  const messageId = ulid()
  await db.transaction(async (tx) => {
    const [maxEntryRow] = await tx
      .select({ val: max(issueLogs.entryIndex) })
      .from(issueLogs)
      .where(eq(issueLogs.issueId, issueId))
    const entryIndex = (maxEntryRow?.val ?? -1) + 1

    const [maxTurnRow] = await tx
      .select({ val: max(issueLogs.turnIndex) })
      .from(issueLogs)
      .where(eq(issueLogs.issueId, issueId))
    const turnIndex = (maxTurnRow?.val ?? -1) + 1

    await tx.insert(issueLogs).values({
      id: messageId,
      issueId,
      turnIndex,
      entryIndex,
      entryType: 'user-message',
      content: prompt.trim(),
      metadata: JSON.stringify(meta),
      timestamp: new Date().toISOString(),
    })
  })
  return messageId
}

/**
 * Collect any queued pending messages, merge them into the prompt.
 * Returns the effective prompt and pending IDs for deferred deletion.
 * Callers MUST delete pending messages only AFTER the engine call succeeds
 * to prevent message loss on failure.
 */
async function collectPendingMessages(
  issueId: string,
  basePrompt: string,
): Promise<{ prompt: string; pendingIds: string[] }> {
  const pending = await getPendingMessages(issueId)
  if (pending.length === 0) return { prompt: basePrompt, pendingIds: [] }
  const prompt = [basePrompt, ...pending.map((m) => m.content)].filter(Boolean).join('\n\n')
  return { prompt, pendingIds: pending.map((m) => m.id) }
}

/**
 * Ensure an issue is in working status before AI execution begins.
 * - todo / done → reject (no execution allowed)
 * - review → move to working, then execute
 * - working → proceed as-is
 */
async function ensureWorking(issue: IssueRow): Promise<{ ok: boolean; reason?: string }> {
  if (issue.statusId === 'todo') {
    return { ok: false, reason: 'Cannot execute a todo issue — move to working first' }
  }
  if (issue.statusId === 'done') {
    return { ok: false, reason: 'Cannot execute a done issue' }
  }
  if (issue.statusId !== 'working') {
    // review → working
    await db.update(issuesTable).set({ statusId: 'working' }).where(eq(issuesTable.id, issue.id))
    emitIssueUpdated(issue.id, { statusId: 'working' })
    logger.info({ issueId: issue.id, from: issue.statusId }, 'moved_to_working')
  }
  return { ok: true }
}

const session = new Hono()

// POST /api/projects/:projectId/issues/:id/execute — Execute engine on issue
session.post(
  '/:id/execute',
  zValidator('json', executeIssueSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: result.error.issues.map((i) => i.message).join(', ') },
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
        if (!resolvedDir.startsWith(`${resolvedRoot}/`) && resolvedDir !== resolvedRoot) {
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
          return c.json({ success: false, error: 'Project directory is not a directory' }, 400)
        }
      } catch {
        return c.json(
          { success: false, error: `Project directory is unavailable: ${resolvedDir}` },
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
      const { prompt: effectivePrompt, pendingIds } = await collectPendingMessages(issueId, prompt)
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
        data: { executionId: result.executionId, issueId, messageId: result.messageId },
      })
    } catch (error) {
      logger.warn(
        {
          projectId: project.id,
          issueId,
          model: body.model,
          permissionMode: body.permissionMode,
          busyAction: body.busyAction,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
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

/**
 * Build a prompt supplement describing uploaded files.
 * Text files: inline content. Images/binary: file path reference.
 */
function buildFileContext(savedFiles: SavedFile[]): string {
  if (savedFiles.length === 0) return ''
  const parts = savedFiles.map((f) => {
    if (f.mimeType.startsWith('image/')) {
      return `[Attached image: ${f.originalName} (${f.mimeType}, ${f.size} bytes) at ${f.absolutePath}]`
    }
    if (
      f.mimeType.startsWith('text/') ||
      f.mimeType === 'application/json' ||
      f.mimeType === 'application/xml'
    ) {
      return `[Attached file: ${f.originalName}] at ${f.absolutePath}`
    }
    return `[Attached file: ${f.originalName} (${f.mimeType}, ${f.size} bytes) at ${f.absolutePath}]`
  })
  return `\n\n--- Attached files ---\n${parts.join('\n')}`
}

/**
 * Parse follow-up body from either JSON or multipart/form-data.
 */
async function parseFollowUpBody(c: {
  req: {
    header: (name: string) => string | undefined
    json: () => Promise<unknown>
    formData: () => Promise<FormData>
  }
}): Promise<
  | {
      ok: true
      prompt: string
      model?: string
      permissionMode?: string
      busyAction?: string
      files: File[]
    }
  | { ok: false; error: string }
> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const fd = await c.req.formData()
    const prompt = fd.get('prompt')
    if (typeof prompt !== 'string') {
      return { ok: false, error: 'Prompt is required' }
    }
    const model = fd.get('model')
    const permissionMode = fd.get('permissionMode')
    const busyAction = fd.get('busyAction')
    const files: File[] = []
    for (const entry of fd.getAll('files')) {
      if (entry instanceof File) files.push(entry)
    }
    return {
      ok: true,
      prompt,
      model: typeof model === 'string' ? model : undefined,
      permissionMode: typeof permissionMode === 'string' ? permissionMode : undefined,
      busyAction: typeof busyAction === 'string' ? busyAction : undefined,
      files,
    }
  }

  // JSON path with Zod validation
  const raw = await c.req.json()
  const parsed = followUpSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  return { ok: true, ...parsed.data, files: [] }
}

// POST /api/projects/:projectId/issues/:id/follow-up — Follow-up
session.post('/:id/follow-up', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const parsed = await parseFollowUpBody(c)
  if (!parsed.ok) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

  const { files } = parsed
  const prompt = normalizePrompt(parsed.prompt)
  if (!prompt && files.length === 0) {
    return c.json({ success: false, error: 'Prompt is required' }, 400)
  }

  // Validate files
  if (files.length > 0) {
    const validation = validateFiles(files)
    if (!validation.ok) {
      return c.json({ success: false, error: validation.error }, 400)
    }
  }

  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  // Save uploaded files and insert attachment records
  let savedFiles: SavedFile[] = []
  if (files.length > 0) {
    savedFiles = await Promise.all(files.map(saveUploadedFile))
  }

  // Build file context for AI engine only
  const fileContext = buildFileContext(savedFiles)
  const fullPrompt = prompt + fileContext
  const attachmentsMeta =
    savedFiles.length > 0 ? { attachments: savedFiles.map(savedFileToMeta) } : {}

  // Queue message for todo/done issues instead of rejecting
  if (issue.statusId === 'todo') {
    const messageId = await persistPendingMessage(issueId, prompt, {
      pending: true,
      ...attachmentsMeta,
    })
    if (savedFiles.length > 0) await insertAttachmentRecords(issueId, messageId, savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }
  if (issue.statusId === 'done') {
    const messageId = await persistPendingMessage(issueId, prompt, {
      done: true,
      ...attachmentsMeta,
    })
    if (savedFiles.length > 0) await insertAttachmentRecords(issueId, messageId, savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  // When the engine is actively processing a turn, queue message as pending
  // so it won't be ignored mid-turn. It will be auto-flushed after the turn settles.
  if (issue.statusId === 'working' && issueEngine.isTurnInFlight(issueId)) {
    const messageId = await persistPendingMessage(issueId, prompt, {
      pending: true,
      ...attachmentsMeta,
    })
    if (savedFiles.length > 0) await insertAttachmentRecords(issueId, messageId, savedFiles)
    logger.debug(
      { issueId, promptChars: prompt.length, fileCount: files.length },
      'followup_queued_during_active_turn',
    )
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  try {
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return c.json({ success: false, error: guard.reason! }, 400)
    }
    const { prompt: effectivePrompt, pendingIds } = await collectPendingMessages(
      issueId,
      fullPrompt,
    )
    const result = await issueEngine.followUpIssue(
      issueId,
      effectivePrompt,
      parsed.model,
      parsed.permissionMode as 'auto' | 'supervised' | 'plan' | undefined,
      parsed.busyAction as 'queue' | 'cancel' | undefined,
      savedFiles.length > 0 ? prompt || undefined : undefined,
      savedFiles.length > 0 ? { ...attachmentsMeta } : undefined,
    )
    await markPendingMessagesDispatched(pendingIds)

    // Link attachments to the server-assigned message log
    if (savedFiles.length > 0 && result.messageId) {
      await insertAttachmentRecords(issueId, result.messageId, savedFiles)
    }

    return c.json({
      success: true,
      data: { executionId: result.executionId, issueId, messageId: result.messageId },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Follow-up failed',
      },
      400,
    )
  }
})

function savedFileToMeta(f: SavedFile) {
  return { id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.size }
}

async function insertAttachmentRecords(
  issueId: string,
  logId: string,
  savedFiles: SavedFile[],
): Promise<void> {
  if (savedFiles.length === 0) return
  await db.insert(attachments).values(
    savedFiles.map((f) => ({
      id: f.id,
      issueId,
      logId,
      originalName: f.originalName,
      storedName: f.storedName,
      mimeType: f.mimeType,
      size: f.size,
      storagePath: f.storagePath,
    })),
  )
}

// GET /api/projects/:projectId/issues/:id/attachments/:attachmentId — Serve attachment file
session.get('/:id/attachments/:attachmentId', async (c) => {
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

  const attachmentId = c.req.param('attachmentId')!
  const [attachment] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.issueId, issueId)))
  if (!attachment) {
    return c.json({ success: false, error: 'Attachment not found' }, 404)
  }

  const filePath = resolve(process.cwd(), attachment.storagePath)

  // SEC-025: Prevent path traversal — resolved path must be inside the uploads directory
  if (!filePath.startsWith(UPLOAD_DIR)) {
    return c.json({ success: false, error: 'Invalid attachment path' }, 400)
  }

  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return c.json({ success: false, error: 'Attachment file missing' }, 404)
  }

  return new Response(file.stream(), {
    headers: {
      'Content-Type': attachment.mimeType,
      // SEC-024: Force download to prevent content-sniffing and XSS via served files
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    },
  })
})

// POST /api/projects/:projectId/issues/:id/restart — Restart a failed issue session
session.post('/:id/restart', async (c) => {
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
session.post('/:id/cancel', async (c) => {
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

export default session
