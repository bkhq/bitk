import type { SavedFile } from '@/uploads'
import { eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { attachments, issueLogs } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { saveUploadedFile, validateFiles } from '@/uploads'
import {
  collectPendingMessages,
  ensureWorking,
  followUpSchema,
  getProjectOwnedIssue,
  markPendingMessagesDispatched,
  normalizePrompt,
} from './_shared'

// ---------- Private helpers ----------

async function persistPendingMessage(
  issueId: string,
  prompt: string,
  meta: Record<string, unknown> = { type: 'pending' },
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
      content: (typeof meta.displayPrompt === 'string' ? meta.displayPrompt : prompt).trim(),
      metadata: JSON.stringify(meta),
      timestamp: new Date().toISOString(),
      visible: 1,
    })
  })
  return messageId
}

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
      meta?: boolean
      displayPrompt?: string
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
    const meta = fd.get('meta')
    const displayPrompt = fd.get('displayPrompt')
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
      meta: meta === 'true' || meta === '1' ? true : undefined,
      displayPrompt: typeof displayPrompt === 'string' ? displayPrompt : undefined,
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

// ---------- Route ----------

const message = new Hono()

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
    const messageId = await persistPendingMessage(issueId, prompt, pendingMeta('pending'))
    if (savedFiles.length > 0) await insertAttachmentRecords(issueId, messageId, savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }
  if (issue.statusId === 'done') {
    const messageId = await persistPendingMessage(issueId, prompt, pendingMeta('done'))
    if (savedFiles.length > 0) await insertAttachmentRecords(issueId, messageId, savedFiles)
    return c.json({ success: true, data: { issueId, messageId, queued: true } })
  }

  // When the engine is actively processing a turn, queue message as pending
  // so it won't be ignored mid-turn. It will be auto-flushed after the turn settles.
  if (issue.statusId === 'working' && issueEngine.isTurnInFlight(issueId)) {
    const messageId = await persistPendingMessage(issueId, prompt, pendingMeta('pending'))
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
    const isCommand = prompt.startsWith('/')
    const followUpMeta: Record<string, unknown> = {
      ...attachmentsMeta,
      ...(parsed.meta ? { type: 'system' } : isCommand ? { type: 'command' } : {}),
    }
    const hasFollowUpMeta = Object.keys(followUpMeta).length > 0
    const result = await issueEngine.followUpIssue(
      issueId,
      effectivePrompt,
      parsed.model,
      parsed.permissionMode as 'auto' | 'supervised' | 'plan' | undefined,
      parsed.busyAction as 'queue' | 'cancel' | undefined,
      parsed.displayPrompt ?? (savedFiles.length > 0 ? prompt || undefined : undefined),
      hasFollowUpMeta ? followUpMeta : undefined,
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

export default message
