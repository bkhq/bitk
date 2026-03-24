import { createOpenAPIRouter } from '@/openapi/hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { getPendingMessages, upsertPendingMessage } from '@/db/pending-messages'
import { attachments } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { emitIssueLogRemoved } from '@/events/issue-events'
import { logger } from '@/logger'
import type { SavedFile } from '@/uploads'
import { saveUploadedFile, validateFiles } from '@/uploads'
import {
  ensureWorking,
  flushPendingAsFollowUp,
  followUpSchema,
  getProjectOwnedIssue,
  normalizePrompt,
} from './_shared'

// ---------- Private helpers ----------

/**
 * Build a prompt supplement describing uploaded files.
 */
function buildFileContext(savedFiles: SavedFile[]): string {
  if (savedFiles.length === 0) return ''
  const parts = savedFiles.map(
    f =>
      `[Attached file: ${f.originalName.replace(/[\r\n]/g, ' ').slice(0, 255)} at ${f.absolutePath.replace(/[\r\n]/g, '')}]`,
  )
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
    meta?: boolean
    displayPrompt?: string
    files: File[]
  } |
  { ok: false, error: string }
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
    const meta = fd.get('meta')
    const displayPrompt = fd.get('displayPrompt')
    const files: File[] = []
    for (const entry of fd.getAll('files')) {
      if (entry instanceof File) files.push(entry)
    }

    // Validate fields to match followUpSchema constraints
    const validBusyActions = ['queue', 'cancel']
    if (typeof busyAction === 'string' && !validBusyActions.includes(busyAction)) {
      return { ok: false, error: 'busyAction must be "queue" or "cancel"' }
    }
    const validPermissionModes = ['auto', 'supervised', 'plan']
    if (typeof permissionMode === 'string' && !validPermissionModes.includes(permissionMode)) {
      return {
        ok: false,
        error: 'permissionMode must be "auto", "supervised", or "plan"',
      }
    }
    const modelPattern = /^[\w./:\-[\]]{1,160}$/
    if (typeof model === 'string' && !modelPattern.test(model)) {
      return {
        ok: false,
        error: 'model must match /^[\\w./:\\-[\\]]{1,160}$/',
      }
    }

    return {
      ok: true,
      prompt,
      model: typeof model === 'string' ? model : undefined,
      permissionMode: typeof permissionMode === 'string' ? permissionMode : undefined,
      busyAction: typeof busyAction === 'string' ? busyAction : undefined,
      meta: meta === 'true' || meta === '1' ? true : undefined,
      displayPrompt: typeof displayPrompt === 'string' ? displayPrompt : undefined,
      files,
    }
  }

  // JSON path with Zod validation
  const raw = await c.req.json()
  const parsed = followUpSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map(i => i.message).join(', '),
    }
  }
  return { ok: true, ...parsed.data, files: [] }
}

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
    savedFiles.map(f => ({
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

/**
 * Insert a pending message and attach uploaded files to that specific row.
 * The frontend already adds the optimistic log entry with the returned messageId.
 */
async function upsertAndNotify(
  issueId: string,
  prompt: string,
  meta: Record<string, unknown>,
  savedFiles: SavedFile[],
): Promise<string> {
  const messageId = await upsertPendingMessage(issueId, prompt, meta)

  if (savedFiles.length > 0) {
    await insertAttachmentRecords(issueId, messageId, savedFiles)
  }

  return messageId
}

// ---------- Route ----------

const message = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:id/follow-up — Follow-up
message.post('/:id/follow-up', async (c) => {
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

  // Reject model changes while the session is actively running
  const isActive = issue.sessionStatus === 'running' || issue.sessionStatus === 'pending'
  if (isActive && parsed.model && parsed.model !== (issue.model ?? '')) {
    return c.json(
      { success: false, error: 'Cannot change model while session is running. Wait for completion or cancel first.' },
      409,
    )
  }

  const pendingBefore = await getPendingMessages(issueId)

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
  // Always store original prompt for engine use; displayPrompt goes in metadata for UI display
  const pendingMeta = (type: string) => ({
    type,
    ...attachmentsMeta,
    ...(parsed.displayPrompt ? { displayPrompt: parsed.displayPrompt } : {}),
  })
  if (issue.statusId === 'todo') {
    const messageId = await upsertAndNotify(issueId, prompt, pendingMeta('pending'), savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }
  if (issue.statusId === 'done') {
    const messageId = await upsertAndNotify(issueId, prompt, pendingMeta('done'), savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  // When the engine is actively processing a turn, queue message as pending
  // so it won't be ignored mid-turn. It will be auto-flushed after the turn settles.
  if (issue.statusId === 'working' && issueEngine.isTurnInFlight(issueId)) {
    const messageId = await upsertAndNotify(issueId, prompt, pendingMeta('pending'), savedFiles)
    logger.debug(
      { issueId, promptChars: prompt.length, fileCount: files.length },
      'followup_queued_during_active_turn',
    )
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  if (issue.statusId === 'working' && pendingBefore.length > 0) {
    const messageId = await upsertAndNotify(issueId, prompt, pendingMeta('pending'), savedFiles)
    flushPendingAsFollowUp(issueId, { model: issue.model })
    logger.debug(
      { issueId, pendingCount: pendingBefore.length + 1 },
      'followup_queued_behind_existing_pending',
    )
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  try {
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return c.json({ success: false, error: guard.reason! }, 400)
    }
    const firstWord = prompt.split(/\s/)[0] ?? ''
    const categorized = issueEngine.getCategorizedCommands(
      issueId,
      (issue.engineType as import('@/engines/types').EngineType) ?? undefined,
    )
    const knownCommands = [
      ...categorized.commands,
      ...categorized.agents,
      ...categorized.plugins.map(p => p.name),
    ].map(cmd => (cmd.startsWith('/') ? cmd : `/${cmd}`))
    const isCommand = firstWord.startsWith('/') && knownCommands.includes(firstWord)
    const followUpMeta: Record<string, unknown> = {
      ...attachmentsMeta,
      ...(parsed.meta ? { type: 'system' } : isCommand ? { type: 'command' } : {}),
    }
    const hasFollowUpMeta = Object.keys(followUpMeta).length > 0
    const result = await issueEngine.followUpIssue(
      issueId,
      fullPrompt,
      parsed.model,
      parsed.permissionMode as 'auto' | 'supervised' | 'plan' | undefined,
      parsed.busyAction as 'queue' | 'cancel' | undefined,
      parsed.displayPrompt ?? (savedFiles.length > 0 ? prompt || undefined : undefined),
      hasFollowUpMeta ? followUpMeta : undefined,
    )
    // Link attachments to the server-assigned message log
    if (savedFiles.length > 0 && result.messageId) {
      await insertAttachmentRecords(issueId, result.messageId, savedFiles)
    }

    return c.json({
      success: true,
      data: {
        executionId: result.executionId,
        issueId,
        messageId: result.messageId,
      },
    })
  } catch (error) {
    // When follow-up fails (e.g. process failed to start), save the current
    // message as pending so it won't be lost. It will be auto-processed on
    // the next execute/restart.
    logger.warn(
      {
        issueId,
        error: error instanceof Error ? error.message : String(error),
      },
      'followup_failed_saving_as_pending',
    )
    try {
      const messageId = await upsertAndNotify(issueId, prompt, pendingMeta('pending'), savedFiles)
      return c.json({
        success: true,
        data: { issueId, messageId, queued: true },
      })
    } catch (persistError) {
      logger.error({ issueId, error: persistError }, 'followup_failed_persist_pending_failed')
    }
    return c.json(
      {
        success: false,
        error: 'Follow-up failed',
      },
      400,
    )
  }
})

// DELETE /api/projects/:projectId/issues/:id/pending?messageId=... — Recall pending message
message.delete('/:id/pending', async (c) => {
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

  const messageId = c.req.query('messageId')?.trim()
  if (!messageId || messageId.length > 26 || !/^[0-9A-Z]{26}$/.test(messageId)) {
    return c.json({ success: false, error: 'messageId must be a valid ULID' }, 400)
  }

  const { deletePendingMessage } = await import('@/db/pending-messages')
  const result = await deletePendingMessage(issueId, messageId)
  if (!result) {
    return c.json({ success: false, error: 'No pending message found' }, 404)
  }

  // Notify frontend to remove the pending message from display
  emitIssueLogRemoved(issueId, [result.id])

  return c.json({
    success: true,
    data: {
      id: result.id,
      content: result.content,
      metadata: result.metadata,
      attachments: result.attachments,
    },
  })
})

export default message
