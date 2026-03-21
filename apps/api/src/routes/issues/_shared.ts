import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import * as z from 'zod'
import { cacheDel, cacheGetOrSet } from '@/cache'
import { STATUS_IDS } from '@/config'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import {
  relocatePendingForProcessing,
  restorePendingVisibility,
} from '@/db/pending-messages'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { isValidAcpEngineType } from '@/engines/startup-probe'
import type { EngineType } from '@/engines/types'
import { emitIssueLogRemoved, emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import { toISO } from '@/utils/date'

const fractionalKeyRegex = /^[a-z0-9]+$/i

export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  tags: z.array(z.string().max(50)).max(10).optional(),
  statusId: z.enum(STATUS_IDS),
  useWorktree: z.boolean().optional(),
  keepAlive: z.boolean().optional(),
  engineType: z.string().refine(
    val => ['claude-code', 'codex', 'acp', 'echo'].includes(val) || isValidAcpEngineType(val),
    { message: 'Invalid engine type' },
  ).optional(),
  model: z
    .string()
    .regex(/^[\w./:\-[\]]{1,160}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
})

export const bulkUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string(),
        statusId: z.enum(STATUS_IDS).optional(),
        sortOrder: z.string().min(1).max(50).regex(fractionalKeyRegex).optional(),
      }),
    )
    .max(1000),
})

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).nullable().optional(),
  statusId: z.enum(STATUS_IDS).optional(),
  sortOrder: z.string().min(1).max(50).regex(fractionalKeyRegex).optional(),
  isPinned: z.boolean().optional(),
  keepAlive: z.boolean().optional(),
})

export const executeIssueSchema = z.object({
  engineType: z.string().refine(
    val => ['claude-code', 'codex', 'acp', 'echo'].includes(val) || isValidAcpEngineType(val),
    { message: 'Invalid engine type' },
  ),
  prompt: z.string().min(1).max(32768),
  model: z
    .string()
    .regex(/^[\w./:\-[\]]{1,160}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
})

export const followUpSchema = z.object({
  prompt: z.string().min(1).max(32768),
  model: z
    .string()
    .regex(/^[\w./:\-[\]]{1,160}$/)
    .optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
  busyAction: z.enum(['queue', 'cancel']).optional(),
  meta: z.boolean().optional(),
  displayPrompt: z.string().max(500).optional(),
})

export type IssueRow = typeof issuesTable.$inferSelect

export function serializeIssue(row: IssueRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    statusId: row.statusId,
    issueNumber: row.issueNumber,
    title: row.title,
    tags: parseTags(row.tag),
    sortOrder: row.sortOrder,
    useWorktree: row.useWorktree,
    isPinned: row.isPinned,
    keepAlive: row.keepAlive,
    // Session fields
    engineType: row.engineType ?? null,
    sessionStatus: row.sessionStatus ?? null,
    prompt: row.prompt ?? null,
    externalSessionId: row.externalSessionId ?? null,
    model: row.model ?? null,
    statusUpdatedAt: toISO(row.statusUpdatedAt),
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

/** Parse JSON-encoded tags from DB text column into string array. */
export function parseTags(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  let candidates: string[]
  try {
    const parsed = JSON.parse(raw)
    candidates = Array.isArray(parsed) ? parsed : [raw]
  } catch {
    candidates = [raw]
  }
  const valid = candidates.filter(
    (s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 50,
  )
  return valid.length > 0 ? valid : null
}

/** Serialize tags array to JSON string for DB storage, or null if empty. */
export function serializeTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null
  return JSON.stringify(tags)
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

export async function invalidateIssueCache(projectId: string, issueId: string): Promise<void> {
  await cacheDel(`issue:${projectId}:${issueId}`)
}

export { toISO } from '@/utils/date'

/** Parse project envVars JSON string into Record<string, string>, or undefined if empty/null. */
export function parseProjectEnvVars(
  raw: string | null | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    return Object.keys(parsed).length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Fire-and-forget: flush pending queued messages as a follow-up to an
 * existing session.  Called when an issue transitions to working but
 * already has a completed/failed session.
 */
export function flushPendingAsFollowUp(issueId: string, issue: { model: string | null }): void {
  void (async () => {
    let relocated: Awaited<ReturnType<typeof relocatePendingForProcessing>> | null = null
    try {
      relocated = await relocatePendingForProcessing(issueId)
      if (!relocated) return
      // Emit SSE so frontend shows "AI thinking" indicator
      emitIssueUpdated(issueId, { sessionStatus: 'pending' })
      await issueEngine.followUpIssue(
        issueId,
        relocated.prompt,
        issue.model ?? undefined,
        undefined, // permissionMode
        'queue', // busyAction
        relocated.displayPrompt,
        relocated.metadata,
      )
      // Notify frontend to remove old pending entries
      emitIssueLogRemoved(issueId, relocated.oldIds)
      logger.debug({ issueId, oldPendingIds: relocated.oldIds, mergedCount: relocated.oldIds.length }, 'pending_flushed_as_followup')
    } catch (err) {
      logger.error({ issueId, err }, 'pending_flush_followup_failed')
      if (relocated) restorePendingVisibility(relocated.oldIds)
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
 * Ensure an issue is in working status before AI execution begins.
 * - todo / done → reject (no execution allowed)
 * - review → move to working, then execute
 * - working → proceed as-is
 */
export async function ensureWorking(issue: IssueRow): Promise<{ ok: boolean, reason?: string }> {
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
      .set({ statusId: 'working', statusUpdatedAt: new Date() })
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
  systemPrompt?: string | null,
  envVars?: Record<string, string> | null,
): void {
  void (async () => {
    let relocated: Awaited<ReturnType<typeof relocatePendingForProcessing>> | null = null
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
            throw new Error('Project directory is outside the configured workspace')
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

      // Relocate any pending messages: hide old pending row, include content in prompt
      relocated = await relocatePendingForProcessing(issueId)
      const basePrompt = systemPrompt ?
        `${systemPrompt}\n\n${issue.prompt ?? ''}` :
          (issue.prompt ?? '')
      const effectivePrompt = relocated ?
          [basePrompt, relocated.prompt].filter(Boolean).join('\n\n') :
        basePrompt

      await issueEngine.executeIssue(issueId, {
        engineType: (issue.engineType ?? 'claude-code') as EngineType,
        prompt: effectivePrompt,
        workingDir: effectiveWorkingDir,
        model: issue.model ?? undefined,
        permissionMode: issue.permissionMode as 'plan' | 'auto' | undefined,
        envVars: envVars ?? undefined,
        ...(relocated ? { displayPrompt: relocated.displayPrompt, metadata: relocated.metadata } : {}),
      })
      // Notify frontend to remove old pending entry after successful execution
      if (relocated) {
        emitIssueLogRemoved(issueId, relocated.oldIds)
      }
      logger.debug({ issueId, hadPending: !!relocated }, 'auto_execute_started')
    } catch (err) {
      logger.error({ issueId, err }, 'auto_execute_failed')
      if (relocated) restorePendingVisibility(relocated.oldIds)
      issueEngine.setLastError(issueId, err instanceof Error ? err.message : 'auto_execute_failed')
      try {
        await db
          .update(issuesTable)
          .set({ sessionStatus: 'failed' })
          .where(eq(issuesTable.id, issueId))
        // Notify frontend so it doesn't stay stuck in "working" state
        emitIssueUpdated(issueId, { sessionStatus: 'failed' })
      } catch (dbErr) {
        logger.error({ issueId, err: dbErr }, 'auto_execute_status_update_failed')
      }
    }
  })()
}
