import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { customAlphabet } from 'nanoid'
import * as z from 'zod'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject, getAppSetting, getDefaultEngine, getEngineDefaultModel } from '@/db/helpers'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { engineRegistry } from '@/engines/executors'
import { getEngineDiscovery } from '@/engines/startup-probe'
import type { EngineType } from '@/engines/types'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import {
  ensureWorking,
  flushPendingAsFollowUp,
  parseProjectEnvVars,
  triggerIssueExecution,
} from '@/routes/issues/_shared'
import { toISO } from '@/utils/date'

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
    parentIssueId: row.parentIssueId ?? null,
    engineType: row.engineType ?? null,
    sessionStatus: row.sessionStatus ?? null,
    model: row.model ?? null,
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
    parentIssueId?: string
    engineType: string | null
    model: string | null
    sessionStatus: string | null
  },
) {
  const { statusId, title, parentIssueId, engineType, model, sessionStatus } = opts

  const [newIssue] = await db.transaction(async (tx) => {
    if (parentIssueId) {
      const [parent] = await tx
        .select()
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.id, parentIssueId),
            eq(issuesTable.projectId, projectId),
            eq(issuesTable.isDeleted, 0),
          ),
        )
      if (!parent) throw new Error('Parent issue not found')
      if (parent.parentIssueId) throw new Error('Cannot nest deeper than 1 level')
    }

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
        parentIssueId: parentIssueId ?? null,
        engineType,
        model,
        sessionStatus,
        prompt: title,
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
      parentId: z.string().optional().describe('Filter by parent issue ID. Use "null" for root issues only.'),
      limit: z.number().min(1).max(MAX_LIST_LIMIT).optional().describe(`Max results. Default: ${DEFAULT_LIST_LIMIT}`),
    }),
  }, async ({ projectId, parentId, limit }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const conditions = [eq(issuesTable.projectId, project.id), eq(issuesTable.isDeleted, 0)]
    if (parentId === 'null') {
      conditions.push(isNull(issuesTable.parentIssueId))
    } else if (parentId) {
      conditions.push(eq(issuesTable.parentIssueId, parentId))
    }

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
    description: 'Create a new issue (task) in a project. Set statusId to "working" to auto-execute with an AI engine.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      title: z.string().min(1).max(500).describe('Issue title / prompt for the AI agent'),
      statusId: z.enum(['todo', 'working', 'review', 'done']).describe('Initial status. Use "working" to auto-execute.'),
      engineType: z.enum(['claude-code', 'codex', 'acp', 'echo']).optional().describe('AI engine type. Defaults to server setting.'),
      model: z.string().optional().describe('Model ID. Defaults to engine default.'),
      parentIssueId: z.string().optional().describe('Parent issue ID for sub-issues'),
    }),
  }, async ({ projectId, title, statusId, engineType, model, parentIssueId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const resolved = await resolveEngineAndModel(engineType, model)
    const shouldExecute = statusId === 'working' || statusId === 'review'
    const effectiveStatusId = statusId === 'review' ? 'working' : statusId

    const newIssue = await insertIssueInTransaction(project.id, {
      statusId: effectiveStatusId,
      title,
      parentIssueId,
      engineType: resolved.engine,
      model: resolved.model,
      sessionStatus: shouldExecute ? 'pending' : null,
    })

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
    description: 'Update an issue\'s title, status, or other fields. Moving to "working" triggers AI execution.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      title: z.string().min(1).max(500).optional().describe('New title'),
      statusId: z.enum(['todo', 'working', 'review', 'done']).optional().describe('New status'),
    }),
  }, async ({ projectId, issueId, title, statusId }) => {
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
    description: 'Soft-delete an issue and its children. Terminates active processes.',
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

    // Soft-delete issue + children in a transaction
    await db.transaction(async (tx) => {
      const childIssues = await tx
        .select({ id: issuesTable.id })
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.parentIssueId, issueId),
            eq(issuesTable.projectId, project.id),
            eq(issuesTable.isDeleted, 0),
          ),
        )
      const childIds = childIssues.map(c => c.id)

      await tx.update(issuesTable).set({ isDeleted: 1 }).where(eq(issuesTable.id, issueId))

      if (childIds.length > 0) {
        await tx.update(issuesTable).set({ isDeleted: 1 }).where(inArray(issuesTable.id, childIds))
      }
    })

    // Invalidate caches
    await cacheDel(`issue:${project.id}:${issueId}`)
    await cacheDelByPrefix(`projectIssueIds:${project.id}`)
    await cacheDelByPrefix(`childCounts:${project.id}`)

    return textResult({ deleted: true, id: issueId })
  })

  // ==================== Execution Tools ====================

  server.registerTool('execute-issue', {
    title: 'Execute Issue',
    description: 'Start AI engine execution on an issue. Automatically moves review issues to working.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      prompt: z.string().min(1).max(32768).describe('Prompt / instructions for the AI agent'),
      engineType: z.enum(['claude-code', 'codex', 'acp', 'echo']).describe('AI engine type'),
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
    description: 'Send a follow-up message to an active AI session on an issue.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      prompt: z.string().min(1).max(32768).describe('Follow-up message'),
      model: z.string().optional().describe('Model ID (cannot change during active session)'),
    }),
  }, async ({ projectId, issueId, prompt, model }) => {
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
    if (issue.externalSessionId && model && model !== (issue.model ?? '')) {
      return errorResult('Model changes are not allowed during an existing session. Restart to use a different model.')
    }

    try {
      const result = await issueEngine.followUpIssue(issueId, prompt, model)
      return textResult({ executionId: result.executionId, issueId, messageId: result.messageId })
    } catch (error) {
      logger.error({ issueId, error }, 'mcp_followup_failed')
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

  // ==================== Issue Logs ====================

  server.registerTool('get-issue-logs', {
    title: 'Get Issue Logs',
    description: 'Get execution logs for an issue. Returns the most recent entries.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      issueId: z.string().describe('Issue ID'),
      limit: z.number().min(1).max(200).optional().describe('Max entries to return. Default: 50'),
    }),
  }, async ({ projectId, issueId, limit }) => {
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

    const rows = await db
      .select()
      .from(issueLogs)
      .where(and(eq(issueLogs.issueId, issueId), eq(issueLogs.isDeleted, 0)))
      .orderBy(desc(issueLogs.id))
      .limit(limit ?? 50)

    return textResult(rows.map(r => ({
      id: r.id,
      entryType: r.entryType,
      content: r.content,
      timestamp: r.timestamp,
      turnIndex: r.turnIndex,
    })))
  })

  return server
}
