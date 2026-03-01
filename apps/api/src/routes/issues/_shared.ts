import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import * as z from 'zod'
import { cacheDel, cacheGetOrSet } from '@/cache'
import { STATUS_IDS } from '@/config'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import {
  getPendingMessages,
  markPendingMessagesDispatched,
} from '@/db/pending-messages'
import {
  attachments as attachmentsTable,
  issues as issuesTable,
} from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import type { EngineType } from '@/engines/types'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import { UPLOAD_DIR } from '@/uploads'
import { toISO } from '@/utils/date'

export const priorityEnum = z.enum(['urgent', 'high', 'medium', 'low'])

export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  priority: priorityEnum.default('medium'),
  statusId: z.enum(STATUS_IDS),
  parentIssueId: z.string().optional(),
  useWorktree: z.boolean().optional(),
  engineType: z.enum(['claude-code', 'codex', 'gemini', 'echo']).optional(),
  model: z
    .string()
    .regex(/^[\w.-]{1,100}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
})

export const bulkUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string(),
        statusId: z.enum(STATUS_IDS).optional(),
        sortOrder: z.number().optional(),
        priority: priorityEnum.optional(),
      }),
    )
    .max(1000),
})

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  priority: priorityEnum.optional(),
  statusId: z.enum(STATUS_IDS).optional(),
  sortOrder: z.number().optional(),
  parentIssueId: z.string().nullable().optional(),
  devMode: z.boolean().optional(),
})

export const executeIssueSchema = z.object({
  engineType: z.enum(['claude-code', 'codex', 'gemini', 'echo']),
  prompt: z.string().min(1).max(32768),
  model: z
    .string()
    .regex(/^[\w.-]{1,100}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
})

export const followUpSchema = z.object({
  prompt: z.string().min(1).max(32768),
  model: z
    .string()
    .regex(/^[\w.\-[\]]{1,100}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
  busyAction: z.enum(['queue', 'cancel']).optional(),
  meta: z.boolean().optional(),
  displayPrompt: z.string().max(500).optional(),
})

export type IssueRow = typeof issuesTable.$inferSelect

export {
  getPendingMessages,
  markPendingMessagesDispatched,
} from '@/db/pending-messages'

export function serializeIssue(row: IssueRow, childCount?: number) {
  return {
    id: row.id,
    projectId: row.projectId,
    statusId: row.statusId,
    issueNumber: row.issueNumber,
    title: row.title,
    priority: row.priority as 'urgent' | 'high' | 'medium' | 'low',
    sortOrder: row.sortOrder,
    parentIssueId: row.parentIssueId ?? null,
    useWorktree: row.useWorktree,
    childCount: childCount ?? 0,
    // Session fields
    engineType: row.engineType ?? null,
    sessionStatus: row.sessionStatus ?? null,
    prompt: row.prompt ?? null,
    externalSessionId: row.externalSessionId ?? null,
    model: row.model ?? null,
    devMode: row.devMode,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

export async function getProjectOwnedIssue(projectId: string, issueId: string) {
  return cacheGetOrSet(`issue:${projectId}:${issueId}`, 30, async () => {
    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, projectId),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    return issue ?? null
  })
}

export async function invalidateIssueCache(
  projectId: string,
  issueId: string,
): Promise<void> {
  await cacheDel(`issue:${projectId}:${issueId}`)
}

export { toISO } from '@/utils/date'

/**
 * Fire-and-forget: flush pending queued messages as a follow-up to an
 * existing session.  Called when an issue transitions to working but
 * already has a completed/failed session.
 */
export function flushPendingAsFollowUp(
  issueId: string,
  issue: { model: string | null },
): void {
  void (async () => {
    try {
      const pending = await getPendingMessages(issueId)
      if (pending.length === 0) return
      const attachmentCtx = await getAttachmentContextForLogIds(
        pending.map((m) => m.id),
      )
      const parts = pending.map((m) => {
        const fileCtx = attachmentCtx.get(m.id) ?? ''
        return (m.content + fileCtx).trim()
      })
      const prompt = parts.filter(Boolean).join('\n\n')
      // Emit SSE so frontend shows "AI thinking" indicator
      emitIssueUpdated(issueId, { sessionStatus: 'pending' })
      await issueEngine.followUpIssue(issueId, prompt, issue.model ?? undefined)
      // Delete pending rows only AFTER successful follow-up to prevent message loss
      await markPendingMessagesDispatched(pending.map((m) => m.id))
      logger.debug(
        { issueId, pendingCount: pending.length },
        'pending_flushed_as_followup',
      )
    } catch (err) {
      logger.error({ issueId, err }, 'pending_flush_followup_failed')
    }
  })()
}

/**
 * Fire-and-forget: resolve working directory and start AI execution.
 * Used by POST create, PATCH single, and PATCH bulk when an issue
 * transitions to working.
 */
// ---------- Shared helpers (used by command.ts & message.ts) ----------

export function normalizePrompt(input: string): string {
  return input.replace(/^(?:\\n|\s)+/g, '').replace(/(?:\\n|\s)+$/g, '')
}

/**
 * Build a file-context prompt supplement from attachment DB rows.
 * Mirrors the logic in message.ts `buildFileContext()` but works from
 * stored attachment records rather than in-memory SavedFile objects.
 */
function buildFileContextFromRows(
  rows: {
    originalName: string
    storedName: string
    mimeType: string
    size: number
  }[],
): string {
  if (rows.length === 0) return ''
  const parts = rows.map((f) => {
    const absolutePath = resolve(UPLOAD_DIR, f.storedName)
    if (f.mimeType.startsWith('image/')) {
      return `[Attached image: ${f.originalName} (${f.mimeType}, ${f.size} bytes) at ${absolutePath}]`
    }
    if (
      f.mimeType.startsWith('text/') ||
      f.mimeType === 'application/json' ||
      f.mimeType === 'application/xml'
    ) {
      return `[Attached file: ${f.originalName}] at ${absolutePath}`
    }
    return `[Attached file: ${f.originalName} (${f.mimeType}, ${f.size} bytes) at ${absolutePath}]`
  })
  return `\n\n--- Attached files ---\n${parts.join('\n')}`
}

/**
 * Look up attachment records for the given log IDs and return file context
 * grouped by log ID.
 */
async function getAttachmentContextForLogIds(
  logIds: string[],
): Promise<Map<string, string>> {
  if (logIds.length === 0) return new Map()
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(inArray(attachmentsTable.logId, logIds))
  const byLogId = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.logId) continue
    const existing = byLogId.get(row.logId) ?? []
    existing.push(row)
    byLogId.set(row.logId, existing)
  }
  const result = new Map<string, string>()
  for (const [logId, attachmentRows] of byLogId) {
    result.set(logId, buildFileContextFromRows(attachmentRows))
  }
  return result
}

/**
 * Collect any queued pending messages, merge them into the prompt.
 * Includes attachment file context so the AI engine sees uploaded files.
 * Returns the effective prompt and pending IDs for deferred deletion.
 * Callers MUST delete pending messages only AFTER the engine call succeeds
 * to prevent message loss on failure.
 */
export async function collectPendingMessages(
  issueId: string,
  basePrompt: string,
): Promise<{ prompt: string; pendingIds: string[] }> {
  const pending = await getPendingMessages(issueId)
  if (pending.length === 0) return { prompt: basePrompt, pendingIds: [] }
  const attachmentCtx = await getAttachmentContextForLogIds(
    pending.map((m) => m.id),
  )
  const parts = pending.map((m) => {
    const fileCtx = attachmentCtx.get(m.id) ?? ''
    return (m.content + fileCtx).trim()
  })
  const prompt = [basePrompt, ...parts].filter(Boolean).join('\n\n')
  return { prompt, pendingIds: pending.map((m) => m.id) }
}

/**
 * Ensure an issue is in working status before AI execution begins.
 * - todo / done → reject (no execution allowed)
 * - review → move to working, then execute
 * - working → proceed as-is
 */
export async function ensureWorking(
  issue: IssueRow,
): Promise<{ ok: boolean; reason?: string }> {
  if (issue.statusId === 'todo') {
    return {
      ok: false,
      reason: 'Cannot execute a todo issue — move to working first',
    }
  }
  if (issue.statusId === 'done') {
    return { ok: false, reason: 'Cannot execute a done issue' }
  }
  if (issue.statusId !== 'working') {
    // review → working
    await db
      .update(issuesTable)
      .set({ statusId: 'working' })
      .where(eq(issuesTable.id, issue.id))
    await cacheDel(`issue:${issue.projectId}:${issue.id}`)
    emitIssueUpdated(issue.id, { statusId: 'working' })
    logger.info({ issueId: issue.id, from: issue.statusId }, 'moved_to_working')
  }
  return { ok: true }
}

export function triggerIssueExecution(
  issueId: string,
  issue: {
    engineType: string | null
    prompt: string | null
    model: string | null
    permissionMode?: string
  },
  projectDirectory: string | undefined,
): void {
  void (async () => {
    try {
      let effectiveWorkingDir: string | undefined
      if (projectDirectory) {
        const resolvedDir = resolve(projectDirectory)

        // SEC-016: Validate directory is within workspace root
        const workspaceRoot = await getAppSetting('workspace:defaultPath')
        if (workspaceRoot && workspaceRoot !== '/') {
          const resolvedRoot = resolve(workspaceRoot)
          if (
            !resolvedDir.startsWith(`${resolvedRoot}/`) &&
            resolvedDir !== resolvedRoot
          ) {
            logger.warn(
              { issueId, resolvedDir, workspaceRoot: resolvedRoot },
              'auto_execute_workdir_outside_workspace',
            )
            // Fall through without setting effectiveWorkingDir — engine runs in default dir
            return
          }
        }

        try {
          await mkdir(resolvedDir, { recursive: true })
          const s = await stat(resolvedDir)
          if (s.isDirectory()) {
            effectiveWorkingDir = resolvedDir
          } else {
            logger.warn(
              { issueId, resolvedDir },
              'auto_execute_workdir_not_directory',
            )
          }
        } catch (error) {
          logger.warn(
            { issueId, resolvedDir, error },
            'auto_execute_workdir_prepare_failed',
          )
        }
      }

      const pending = await getPendingMessages(issueId)
      let effectivePrompt = issue.prompt ?? ''
      if (pending.length > 0) {
        const attachmentCtx = await getAttachmentContextForLogIds(
          pending.map((m) => m.id),
        )
        const parts = pending.map((m) => {
          const fileCtx = attachmentCtx.get(m.id) ?? ''
          return (m.content + fileCtx).trim()
        })
        effectivePrompt = [effectivePrompt, ...parts]
          .filter(Boolean)
          .join('\n\n')
      }

      await issueEngine.executeIssue(issueId, {
        engineType: (issue.engineType ?? 'echo') as EngineType,
        prompt: effectivePrompt,
        workingDir: effectiveWorkingDir,
        model: issue.model ?? undefined,
        permissionMode: issue.permissionMode as 'plan' | 'auto' | undefined,
      })
      // Delete pending rows only AFTER successful execution to prevent message loss
      if (pending.length > 0) {
        await markPendingMessagesDispatched(pending.map((m) => m.id))
      }
      logger.debug(
        { issueId, pendingCount: pending.length },
        'auto_execute_started',
      )
    } catch (err) {
      logger.error({ issueId, err }, 'auto_execute_failed')
      issueEngine.setLastError(
        issueId,
        err instanceof Error ? err.message : 'auto_execute_failed',
      )
      try {
        await db
          .update(issuesTable)
          .set({ sessionStatus: 'failed' })
          .where(eq(issuesTable.id, issueId))
      } catch (dbErr) {
        logger.error(
          { issueId, err: dbErr },
          'auto_execute_status_update_failed',
        )
      }
    }
  })()
}
