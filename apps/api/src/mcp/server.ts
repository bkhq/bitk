// @ts-nocheck -- @modelcontextprotocol/sdk subpath exports may not resolve under Bun monorepo hoisting
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, asc, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { customAlphabet } from 'nanoid'
import * as z from 'zod'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject, getAppSetting, getDefaultEngine, getEngineDefaultModel, getServerUrl } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getLogsFromDb, getNextTurnIndex } from '@/engines/issue/persistence/queries'
import { engineRegistry } from '@/engines/executors'
import { getEngineDiscovery } from '@/engines/startup-probe'
import type { EngineType } from '@/engines/types'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import {
  ensureWorking,
  flushPendingAsFollowUp,
  parseProjectEnvVars,
  parseTags,
  serializeTags,
  triggerIssueExecution,
} from '@/routes/issues/_shared'
import { buildProcessInfoList } from '@/routes/processes'
import { toISO } from '@/utils/date'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'

// --- Constants ---

const DEFAULT_LIST_LIMIT = 200
const MAX_LIST_LIMIT = 500

// --- Serialization helpers ---

function serializeProject(row: typeof projectsTable.$inferSelect) {
  return {
    id: row.id,
    alias: row.alias,
    name: row.name,
    description: row.description ?? undefined,
    directory: row.directory ?? undefined,
    repositoryUrl: row.repositoryUrl ?? undefined,
    isArchived: row.isArchived === 1,
    sortOrder: row.sortOrder,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

function serializeIssue(row: typeof issuesTable.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    statusId: row.statusId,
    issueNumber: row.issueNumber,
    title: row.title,
    tags: parseTags(row.tag),
    engineType: row.engineType ?? null,
    sessionStatus: row.sessionStatus ?? null,
    model: row.model ?? null,
    keepAlive: row.keepAlive,
    statusUpdatedAt: toISO(row.statusUpdatedAt),
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

// --- Shared helpers ---

const aliasId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

async function isDirectoryTaken(directory: string): Promise<boolean> {
  const conditions = [eq(projectsTable.directory, directory), eq(projectsTable.isDeleted, 0)]
  const [existing] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(...conditions))
  return !!existing
}

async function resolveEngineAndModel(engineType?: string, model?: string) {
  let resolvedEngine = engineType ?? null
  let resolvedModel = model ?? null

  if (!resolvedEngine) {
    resolvedEngine = ((await getDefaultEngine()) || 'echo') as string
  }
  if (!resolvedModel) {
    const savedModel = await getEngineDefaultModel(resolvedEngine)
    if (savedModel) {
      resolvedModel = savedModel
    } else {
      const models = await engineRegistry.getModels(resolvedEngine as EngineType)
      resolvedModel = models.find(m => m.isDefault)?.id ?? models[0]?.id ?? 'auto'
    }
  }

  return { engine: resolvedEngine, model: resolvedModel }
}

/**
 * SEC-016: Validate and prepare working directory within workspace root.
 * Returns the resolved dir or an error string.
 */
async function resolveWorkingDir(
  projectDirectory: string | undefined,
): Promise<{ dir?: string, error?: string }> {
  if (!projectDirectory) return {}

  const resolvedDir = resolve(projectDirectory)

  // Validate directory is within workspace root
  const workspaceRoot = await getAppSetting('workspace:defaultPath')
  if (workspaceRoot && workspaceRoot !== '/') {
    const resolvedRoot = resolve(workspaceRoot)
    if (!resolvedDir.startsWith(`${resolvedRoot}/`) && resolvedDir !== resolvedRoot) {
      return { error: 'Project directory is outside the configured workspace' }
    }
  }

  try {
    await mkdir(resolvedDir, { recursive: true })
    const s = await stat(resolvedDir)
    if (!s.isDirectory()) {
      return { error: 'Project directory is not a directory' }
    }
  } catch {
    return { error: `Failed to prepare project directory: ${resolvedDir}` }
  }

  return { dir: resolvedDir }
}

async function insertIssueInTransaction(
  projectId: string,
  opts: {
    statusId: string
    title: string
    engineType: string | null
    model: string | null
    sessionStatus: string | null
    useWorktree?: boolean
    keepAlive?: boolean
    tags?: string[]
  },
) {
  const { statusId, title, engineType, model, sessionStatus, useWorktree, keepAlive, tags } = opts

  const [newIssue] = await db.transaction(async (tx) => {
    const [maxNumRow] = await tx
      .select({ maxNum: max(issuesTable.issueNumber) })
      .from(issuesTable)
      .where(eq(issuesTable.projectId, projectId))
    const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

    const [lastItem] = await tx
      .select({ sortOrder: issuesTable.sortOrder })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.projectId, projectId),
          eq(issuesTable.statusId, statusId),
          eq(issuesTable.isDeleted, 0),
        ),
      )
      .orderBy(desc(issuesTable.sortOrder))
      .limit(1)
    const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

    return tx
      .insert(issuesTable)
      .values({
        projectId,
        statusId,
        issueNumber,
        title,
        sortOrder,
        engineType,
        model,
        sessionStatus,
        prompt: title,
        useWorktree: useWorktree ?? false,
        keepAlive: keepAlive ?? false,
        tag: serializeTags(tags),
      })
      .returning()
  })

  return newIssue!
}

// --- MCP Server Factory ---

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'bkd', version: '1.0.0' },
    { capabilities: { logging: {} } },
  )

  // ==================== Project Tools ====================

  server.registerTool('list-projects', {
    title: 'List Projects',
    description: 'List all projects. Optionally filter by archived status.',
    inputSchema: z.object({
      archived: z.boolean().optional().describe('If true, list archived projects only. Omit to list all non-deleted projects.'),
      limit: z.number().min(1).max(MAX_LIST_LIMIT).optional().describe(`Max results. Default: ${DEFAULT_LIST_LIMIT}`),
    }),
  }, async ({ archived, limit }) => {
    const conditions = [eq(projectsTable.isDeleted, 0)]
    if (archived !== undefined) {
      conditions.push(eq(projectsTable.isArchived, archived ? 1 : 0))
    }

    const rows = await db
      .select()
      .from(projectsTable)
      .where(and(...conditions))
      .orderBy(asc(projectsTable.sortOrder), desc(projectsTable.updatedAt))
      .limit(limit ?? DEFAULT_LIST_LIMIT)
    return textResult(rows.map(serializeProject))
  })

  server.registerTool('get-project', {
    title: 'Get Project',
    description: 'Get a project by ID or alias.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
    }),
  }, async ({ projectId }) => {
    const row = await findProject(projectId)
    if (!row) return errorResult('Project not found')
    return textResult(serializeProject(row))
  })

  server.registerTool('create-project', {
    title: 'Create Project',
    description: 'Create a new project for managing AI agent tasks.',
    inputSchema: z.object({
      name: z.string().min(1).max(200).describe('Project name'),
      description: z.string().max(5000).optional().describe('Project description'),
      directory: z.string().max(1000).optional().describe('Working directory path for the project'),
    }),
  }, async ({ name, description, directory }) => {
    const alias = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || aliasId()

    // Check alias uniqueness
    let candidate = alias
    let suffix = 2
    for (;;) {
      const [existing] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.alias, candidate))
      if (!existing) break
      candidate = `${alias}${suffix}`
      suffix++
    }

    const dir = directory ? resolve(directory) : null

    // Check directory uniqueness
    if (dir && await isDirectoryTaken(dir)) {
      return errorResult('Directory is already used by another project')
    }

    // Compute sortOrder
    const lastProject = await db
      .select({ sortOrder: projectsTable.sortOrder })
      .from(projectsTable)
      .where(eq(projectsTable.isDeleted, 0))
      .orderBy(desc(projectsTable.sortOrder))
      .limit(1)
      .then(rows => rows[0])
    const sortOrder = generateKeyBetween(lastProject?.sortOrder ?? null, null)

    const [row] = await db
      .insert(projectsTable)
      .values({
        name,
        alias: candidate,
        description: description ?? null,
        directory: dir,
        sortOrder,
      })
      .returning()

    return textResult(serializeProject(row!))
  })

  // ==================== Issue Tools ====================

  server.registerTool('list-issues', {
    title: 'List Issues',
    description: 'List all issues in a project. Returns issues sorted by status update time.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      limit: z.number().min(1).max(MAX_LIST_LIMIT).optional().describe(`Max results. Default: ${DEFAULT_LIST_LIMIT}`),
    }),
  }, async ({ projectId, limit }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const conditions = [eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)]

    const rows = await db
      .select()
      .from(issuesTable)
      .where(and(...conditions))
      .orderBy(desc(issuesTable.statusUpdatedAt))
      .limit(limit ?? DEFAULT_LIST_LIMIT)

    return textResult(rows.map(r => serializeIssue(r)))
  })

  server.registerTool('get-issue', {
    title: 'Get Issue',
    description: 'Get a single issue by ID within a project.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
    }),
  }, async ({ projectId, issueId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')
    return textResult(serializeIssue(issue))
  })

  server.registerTool('create-issue', {
    title: 'Create Issue',
    description: [
      'Create a new issue (task) in a project.',
      '',
      'IMPORTANT — Recommended workflow:',
      '1. Create the issue with statusId="todo" and a SHORT title.',
      '2. Use follow-up-issue to send detailed requirements, context, and instructions.',
      '3. Use update-issue to change statusId to "working" to trigger AI execution.',
      '',
      'DO NOT create with statusId="working" if you plan to send a follow-up — the engine will start executing',
      'immediately with only the title, before your follow-up arrives.',
      '',
      'Best practices:',
      '- Use a SHORT, concise title (e.g. "fix login bug", "add dark mode").',
      '- For complex tasks involving multiple files or large changes, set useWorktree=true.',
      '- Check list-processes before starting new tasks to monitor system workload.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      title: z.string().min(1).max(500).describe('Short, concise issue title (e.g. "fix auth bug"). Send detailed requirements via follow-up-issue after creation.'),
      statusId: z.enum(['todo', 'working', 'review', 'done']).describe('Initial status. Use "todo" when you need to send follow-up details before execution. Use "working" only for simple tasks that need no further context.'),
      engineType: z.enum(['claude-code', 'codex']).optional().describe('AI engine type. Defaults to server setting.'),
      model: z.string().optional().describe('Model ID. Defaults to engine default.'),
      useWorktree: z.boolean().optional().describe('If true, execute in an isolated git worktree. Recommended for complex multi-file changes.'),
      keepAlive: z.boolean().optional().describe('If true, prevent idle timeout from terminating the process. Useful for long-running sessions.'),
      tags: z.array(z.string().max(50)).max(10).optional().describe('Tags for grouping issues (max 10 tags, each max 50 chars).'),
    }),
  }, async ({ projectId, title, statusId, engineType, model, useWorktree, keepAlive, tags }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const resolved = await resolveEngineAndModel(engineType, model)
    const shouldExecute = statusId === 'working' || statusId === 'review'
    const effectiveStatusId = statusId === 'review' ? 'working' : statusId

    const newIssue = await insertIssueInTransaction(project.id, {
      statusId: effectiveStatusId,
      title,
      engineType: resolved.engine,
      model: resolved.model,
      sessionStatus: shouldExecute ? 'pending' : null,
      useWorktree,
      keepAlive,
      tags,
    })

    // Dispatch webhook (mirrors routes/issues/create.ts)
    const webhookPayload: Record<string, unknown> = {
      event: 'issue.created',
      issueId: newIssue.id,
      issueNumber: newIssue.issueNumber,
      projectId: project.id,
      projectName: project.name,
      title,
      statusId: effectiveStatusId,
      engineType: resolved.engine,
      model: resolved.model,
      timestamp: new Date().toISOString(),
    }
    const srvUrl = await getServerUrl()
    if (srvUrl) {
      webhookPayload.issueUrl = buildIssueUrl(srvUrl, project.id, newIssue.id)
    }
    void webhookDispatch('issue.created', webhookPayload, `issue.created:${newIssue.id}`)

    if (shouldExecute) {
      triggerIssueExecution(
        newIssue.id,
        { engineType: resolved.engine, prompt: title, model: resolved.model },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    return textResult(serializeIssue(newIssue))
  })

  server.registerTool('update-issue', {
    title: 'Update Issue',
    description: [
      'Update an issue\'s title, status, or other fields. Moving to "working" triggers AI execution.',
      '',
      'Completion workflow:',
      '- When a task is finished, move to "review" (not "done") to await human confirmation.',
      '- Only move to "done" after human review and approval.',
      '- For git repos, ensure changes are committed by feature/function before moving to review.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      title: z.string().min(1).max(500).optional().describe('New title'),
      statusId: z.enum(['todo', 'working', 'review', 'done']).optional().describe('New status'),
      keepAlive: z.boolean().optional().describe('If true, prevent idle timeout from terminating the process.'),
      tags: z.array(z.string().max(50)).max(10).nullable().optional().describe('Tags for grouping issues. Pass null to clear tags.'),
    }),
  }, async ({ projectId, issueId, title, statusId, keepAlive, tags }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [existing] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!existing) return errorResult('Issue not found')

    const transitioningToWorking = statusId === 'working' && existing.statusId !== 'working'
    const shouldExecute = transitioningToWorking && (!existing.sessionStatus || existing.sessionStatus === 'pending')
    const shouldFlush = transitioningToWorking
      && !shouldExecute
      && ['completed', 'failed', 'cancelled'].includes(existing.sessionStatus ?? '')
    const transitioningToDone = statusId === 'done' && existing.statusId !== 'done'

    const updates = {
      ...(title !== undefined && { title }),
      ...(statusId !== undefined && { statusId }),
      ...(statusId !== undefined && statusId !== existing.statusId && { statusUpdatedAt: new Date() }),
      ...(shouldExecute && { sessionStatus: 'pending' as const }),
      ...(keepAlive !== undefined && { keepAlive }),
      ...(tags !== undefined && { tag: serializeTags(tags) }),
    }

    // Sync keepAlive to in-memory process so GC picks up the change immediately
    if (keepAlive !== undefined) {
      issueEngine.updateKeepAlive(issueId, keepAlive)
    }

    if (Object.keys(updates).length === 0) {
      return textResult(serializeIssue(existing))
    }

    const [row] = await db
      .update(issuesTable)
      .set(updates)
      .where(eq(issuesTable.id, issueId))
      .returning()

    // Invalidate cache + emit SSE event for UI sync
    await cacheDel(`issue:${project.id}:${issueId}`)
    emitIssueUpdated(issueId, updates)

    if (shouldExecute) {
      triggerIssueExecution(
        issueId,
        { engineType: existing.engineType, prompt: existing.prompt, model: existing.model },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    } else if (shouldFlush) {
      flushPendingAsFollowUp(issueId, { model: existing.model })
    }

    // Cancel active processes when moving to done
    if (transitioningToDone) {
      void issueEngine.cancelIssue(issueId).catch((err) => {
        logger.error({ issueId, err }, 'mcp_done_cancel_failed')
      })
    }

    return textResult(serializeIssue(row!))
  })

  server.registerTool('delete-issue', {
    title: 'Delete Issue',
    description: 'Soft-delete an issue. Terminates active processes.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
    }),
  }, async ({ projectId, issueId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [existing] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!existing) return errorResult('Issue not found')

    // Best-effort terminate active processes (5s timeout)
    const shouldTerminate =
      existing.sessionStatus === 'running'
      || existing.sessionStatus === 'pending'
      || issueEngine.hasActiveProcessForIssue(issueId)
    if (shouldTerminate) {
      try {
        await Promise.race([
          issueEngine.terminateProcess(issueId),
          new Promise<never>((_, reject) =>
            setTimeout(reject, 5_000, new Error('terminate timeout')),
          ),
        ])
      } catch (err) {
        logger.warn({ issueId, err }, 'mcp_delete_terminate_failed')
      }
    }

    // Soft-delete the issue
    await db
      .update(issuesTable)
      .set({ isDeleted: 1 })
      .where(eq(issuesTable.id, issueId))

    // Invalidate caches
    await cacheDel(`issue:${project.id}:${issueId}`)
    await cacheDelByPrefix(`projectIssueIds:${project.id}`)

    return textResult({ deleted: true, id: issueId })
  })

  // ==================== Execution Tools ====================

  server.registerTool('execute-issue', {
    title: 'Execute Issue',
    description: [
      'Start AI engine execution on an issue. Automatically moves review issues to working.',
      '',
      'Important reminders:',
      '- Ensure the project has correct global configuration (system prompt, env vars, working directory) before executing to prevent task failures.',
      '- Check list-processes to monitor current workload before starting new executions.',
      '- After task completion, the issue should be moved to "review" (not "done") to await human confirmation.',
      '- For git repositories, commit changes organized by feature/function before moving to review.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      prompt: z.string().min(1).max(32768).describe('Prompt / instructions for the AI agent'),
      engineType: z.enum(['claude-code', 'codex']).describe('AI engine type'),
      model: z.string().optional().describe('Model ID'),
    }),
  }, async ({ projectId, issueId, prompt, engineType, model }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')

    // ensureWorking: rejects todo/done, moves review→working
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return errorResult(guard.reason!)
    }

    // SEC-016: Validate working directory within workspace
    const { dir: effectiveWorkingDir, error: dirError } = await resolveWorkingDir(
      project.directory || undefined,
    )
    if (dirError) return errorResult(dirError)

    try {
      const basePrompt = project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt
      const envVars = parseProjectEnvVars(project.envVars)
      const result = await issueEngine.executeIssue(issueId, {
        engineType: engineType as EngineType,
        prompt: basePrompt,
        workingDir: effectiveWorkingDir,
        model,
        envVars,
      })
      return textResult({ executionId: result.executionId, issueId, messageId: result.messageId })
    } catch (error) {
      logger.error({ issueId, error }, 'mcp_execute_failed')
      return errorResult(`Execution failed: ${toMessage(error)}`)
    }
  })

  server.registerTool('follow-up-issue', {
    title: 'Follow Up Issue',
    description: [
      'Send a follow-up message to an issue.',
      '',
      'Typical workflow: create-issue (todo) → follow-up-issue (send details) → update-issue (statusId="working").',
      '',
      'Works in any issue state:',
      '- todo/done: message is queued and will be processed when the issue starts executing.',
      '- working (busy): message is queued until the current turn finishes.',
      '- working (idle) or review: triggers immediate follow-up.',
      '',
      'Best practices:',
      '- Use this to send detailed requirements after creating an issue with a short title.',
      '- Include specific context: acceptance criteria, constraints, file paths, code examples.',
      '- For git repos, remind the agent to commit changes by feature and move issue to "review" when done.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      prompt: z.string().min(1).max(32768).describe('Follow-up message with detailed requirements'),
      model: z.string().optional().describe('Model ID (cannot change during active session)'),
    }),
  }, async ({ projectId, issueId, prompt, model }) => {
    const { getPendingMessages, upsertPendingMessage } = await import('@/db/pending-messages')

    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')

    // Block model change during active session
    const isActive = issue.sessionStatus === 'running' || issue.sessionStatus === 'pending'
    if (isActive && model && model !== (issue.model ?? '')) {
      return errorResult('Cannot change model while session is running. Wait for completion or cancel first.')
    }

    // Queue message for todo/done issues
    if (issue.statusId === 'todo') {
      const messageId = await upsertPendingMessage(issueId, prompt, { type: 'pending' })
      return textResult({ issueId, messageId, queued: true })
    }
    if (issue.statusId === 'done') {
      const messageId = await upsertPendingMessage(issueId, prompt, { type: 'done' })
      return textResult({ issueId, messageId, queued: true })
    }

    // Queue if engine is actively processing a turn
    if (issue.statusId === 'working' && issueEngine.isTurnInFlight(issueId)) {
      const messageId = await upsertPendingMessage(issueId, prompt, { type: 'pending' })
      logger.debug({ issueId, promptChars: prompt.length }, 'mcp_followup_queued_during_active_turn')
      return textResult({ issueId, messageId, queued: true })
    }

    // Queue behind existing pending messages
    const pendingBefore = await getPendingMessages(issueId)
    if (issue.statusId === 'working' && pendingBefore.length > 0) {
      const messageId = await upsertPendingMessage(issueId, prompt, { type: 'pending' })
      flushPendingAsFollowUp(issueId, { model: issue.model })
      logger.debug({ issueId, pendingCount: pendingBefore.length + 1 }, 'mcp_followup_queued_behind_existing')
      return textResult({ issueId, messageId, queued: true })
    }

    try {
      // Ensure issue is in working state (review → working transition)
      const guard = await ensureWorking(issue)
      if (!guard.ok) return errorResult(guard.reason!)

      const result = await issueEngine.followUpIssue(issueId, prompt, model)
      return textResult({ executionId: result.executionId, issueId, messageId: result.messageId })
    } catch (error) {
      // Save as pending so message isn't lost
      logger.warn({ issueId, error: error instanceof Error ? error.message : String(error) }, 'mcp_followup_failed_saving_as_pending')
      try {
        const messageId = await upsertPendingMessage(issueId, prompt, { type: 'pending' })
        return textResult({ issueId, messageId, queued: true })
      } catch (persistError) {
        logger.error({ issueId, error: persistError }, 'mcp_followup_persist_pending_failed')
      }
      return errorResult(`Follow-up failed: ${toMessage(error)}`)
    }
  })

  server.registerTool('cancel-issue', {
    title: 'Cancel Issue Execution',
    description: 'Cancel the active AI engine session on an issue.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
    }),
  }, async ({ projectId, issueId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')

    try {
      const status = await issueEngine.cancelIssue(issueId)
      return textResult({ issueId, status })
    } catch (error) {
      return errorResult(`Cancel failed: ${toMessage(error)}`)
    }
  })

  server.registerTool('restart-issue', {
    title: 'Restart Issue',
    description: 'Restart a failed AI session on an issue. Automatically moves review issues to working.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
    }),
  }, async ({ projectId, issueId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')

    // ensureWorking: rejects todo/done, moves review→working
    const guard = await ensureWorking(issue)
    if (!guard.ok) {
      return errorResult(guard.reason!)
    }

    try {
      const result = await issueEngine.restartIssue(issueId)
      return textResult({ executionId: result.executionId, issueId })
    } catch (error) {
      return errorResult(`Restart failed: ${toMessage(error)}`)
    }
  })

  // ==================== Engine Tools ====================

  server.registerTool('list-engines', {
    title: 'List Available Engines',
    description: 'List all available AI engines and their models.',
    inputSchema: z.object({}),
  }, async () => {
    const { engines, models } = await getEngineDiscovery()
    return textResult({ engines, models })
  })

  // ==================== Process Monitoring ====================

  server.registerTool('list-processes', {
    title: 'List Active Processes',
    description: 'List all active AI engine processes across all projects. Returns process count, state, engine type, model, and associated issue/project info. Use this to monitor system workload before starting new tasks.',
    inputSchema: z.object({}),
  }, async () => {
    const processes = await buildProcessInfoList()
    const summary = {
      totalActive: processes.length,
      byState: {} as Record<string, number>,
      byEngine: {} as Record<string, number>,
      byProject: {} as Record<string, { projectName: string, count: number }>,
    }

    for (const p of processes) {
      summary.byState[p.processState] = (summary.byState[p.processState] ?? 0) + 1
      summary.byEngine[p.engineType] = (summary.byEngine[p.engineType] ?? 0) + 1
      if (!summary.byProject[p.projectId]) {
        summary.byProject[p.projectId] = { projectName: p.projectName, count: 0 }
      }
      summary.byProject[p.projectId].count++
    }

    return textResult({ summary, processes })
  })

  // ==================== Issue Logs ====================

  server.registerTool('get-issue-logs', {
    title: 'Get Issue Logs',
    description: [
      'Get execution logs for an issue. By default returns only user and assistant messages (no tool output noise).',
      '',
      'Features:',
      '- Set lastTurn=true to get only the last turn\'s conversation (useful for checking the latest agent response).',
      '- Returns sessionStatus so you know the current session state (running/completed/failed/cancelled).',
      '- Analyze the last assistant message content to determine if the agent is waiting for user input (e.g. asking questions, requesting confirmation).',
      '- Based on the content and sessionStatus, decide next action: send a follow-up, restart, or move to review.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      limit: z.number().min(1).max(200).optional().describe('Max entries to return. Default: 50'),
      lastTurn: z.boolean().optional().describe('If true, return only the last turn\'s user and assistant messages.'),
      entryTypes: z.array(z.enum(['user-message', 'assistant-message', 'tool-use', 'system-message', 'thinking']))
        .optional()
        .describe('Entry types to include. Default: ["user-message", "assistant-message"]'),
    }),
  }, async ({ projectId, issueId, limit, lastTurn, entryTypes }: { projectId: string, issueId: string, limit?: number, lastTurn?: boolean, entryTypes?: string[] }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const [issue] = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.id, issueId),
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.isDeleted, 0),
        ),
      )
    if (!issue) return errorResult('Issue not found')

    // When lastTurn is requested, ignore caller limit to return the full turn
    const queryOpts: Parameters<typeof getLogsFromDb>[1] = {
      limit: lastTurn ? 200 : (limit ?? 50),
      entryTypes: entryTypes ?? ['user-message', 'assistant-message'],
    }

    // Filter to last turn if requested
    if (lastTurn) {
      const nextTurn = getNextTurnIndex(issueId)
      if (nextTurn === 0) {
        return textResult({ sessionStatus: issue.sessionStatus ?? null, entries: [] })
      }
      queryOpts.turnIndex = nextTurn - 1
      queryOpts.turnIndexEnd = nextTurn - 1
    }

    const { entries } = getLogsFromDb(issueId, queryOpts)

    return textResult({
      sessionStatus: issue.sessionStatus ?? null,
      entries: entries.map(e => ({
        id: e.messageId,
        entryType: e.entryType,
        content: e.content,
        timestamp: e.timestamp,
        turnIndex: e.turnIndex,
      })),
    })
  })

  return server
}
