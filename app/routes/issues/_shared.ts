import type { EngineType } from '../../engines/types'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { STATUS_IDS } from '../../config'
import { db } from '../../db'
import { getAppSetting } from '../../db/helpers'
import { getPendingMessages, markPendingMessagesDispatched } from '../../db/pending-messages'
import { issues as issuesTable } from '../../db/schema'
import { issueEngine } from '../../engines/issue-engine'
import { emitIssueUpdated } from '../../events/issue-events'
import { logger } from '../../logger'

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
})

export type IssueRow = typeof issuesTable.$inferSelect

export function toISO(v: Date | number | string): string {
  if (v instanceof Date) return v.toISOString()
  return new Date(typeof v === 'string' ? v : v * 1000).toISOString()
}

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
    baseCommitHash: row.baseCommitHash ?? null,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

export async function getProjectOwnedIssue(projectId: string, issueId: string) {
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
}

export { getPendingMessages, markPendingMessagesDispatched } from '../../db/pending-messages'

/**
 * Fire-and-forget: flush pending queued messages as a follow-up to an
 * existing session.  Called when an issue transitions to working but
 * already has a completed/failed session.
 */
export function flushPendingAsFollowUp(issueId: string, issue: { model: string | null }): void {
  void (async () => {
    try {
      const pending = await getPendingMessages(issueId)
      if (pending.length === 0) return
      const prompt = pending
        .map((m) => m.content)
        .filter(Boolean)
        .join('\n\n')
      // Emit SSE so frontend shows "AI thinking" indicator
      emitIssueUpdated(issueId, { sessionStatus: 'pending' })
      await issueEngine.followUpIssue(issueId, prompt, issue.model ?? undefined)
      // Delete pending rows only AFTER successful follow-up to prevent message loss
      await markPendingMessagesDispatched(pending.map((m) => m.id))
      logger.debug({ issueId, pendingCount: pending.length }, 'pending_flushed_as_followup')
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
          if (!resolvedDir.startsWith(`${resolvedRoot}/`) && resolvedDir !== resolvedRoot) {
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
            logger.warn({ issueId, resolvedDir }, 'auto_execute_workdir_not_directory')
          }
        } catch (error) {
          logger.warn({ issueId, resolvedDir, error }, 'auto_execute_workdir_prepare_failed')
        }
      }

      const pending = await getPendingMessages(issueId)
      let effectivePrompt = issue.prompt ?? ''
      if (pending.length > 0) {
        effectivePrompt = [effectivePrompt, ...pending.map((m) => m.content)]
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
      logger.debug({ issueId, pendingCount: pending.length }, 'auto_execute_started')
    } catch (err) {
      logger.error({ issueId, err }, 'auto_execute_failed')
      try {
        await db
          .update(issuesTable)
          .set({ sessionStatus: 'failed' })
          .where(eq(issuesTable.id, issueId))
      } catch (dbErr) {
        logger.error({ issueId, err: dbErr }, 'auto_execute_status_update_failed')
      }
    }
  })()
}
