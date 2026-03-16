import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import { db } from '@/db'
import { findProject, getDefaultEngine, getEngineDefaultModel } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { engineRegistry } from '@/engines/executors'
import { getEngineDiscovery } from '@/engines/startup-probe'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { toISO } from '@/utils/date'

// --- Serialization helpers (mirrors route-level serializers) ---

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
      archived: z.boolean().optional().describe('If true, list archived projects only. Default: false'),
    }),
  }, async ({ archived }) => {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.isDeleted, 0), eq(projectsTable.isArchived, archived ? 1 : 0)))
      .orderBy(asc(projectsTable.sortOrder), desc(projectsTable.updatedAt))
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
    const { resolve } = await import('node:path')
    const { generateKeyBetween } = await import('jittered-fractional-indexing')
    const { customAlphabet } = await import('nanoid')

    const aliasId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)
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
    }),
  }, async ({ projectId, parentId }) => {
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

    // Resolve engine/model defaults
    let resolvedEngine = engineType ?? null
    let resolvedModel = model ?? null

    if (!resolvedEngine) {
      resolvedEngine = ((await getDefaultEngine()) || 'echo') as EngineType
    }
    if (!resolvedModel) {
      const savedModel = await getEngineDefaultModel(resolvedEngine!)
      if (savedModel) {
        resolvedModel = savedModel
      } else {
        const models = await engineRegistry.getModels(resolvedEngine as EngineType)
        resolvedModel = models.find(m => m.isDefault)?.id ?? models[0]?.id ?? 'auto'
      }
    }

    const { generateKeyBetween } = await import('jittered-fractional-indexing')
    const { max } = await import('drizzle-orm')

    const shouldExecute = statusId === 'working' || statusId === 'review'
    const effectiveStatusId = statusId === 'review' ? 'working' : statusId

    const [newIssue] = await db.transaction(async (tx) => {
      if (parentIssueId) {
        const [parent] = await tx
          .select()
          .from(issuesTable)
          .where(
            and(
              eq(issuesTable.id, parentIssueId),
              eq(issuesTable.projectId, project.id),
              eq(issuesTable.isDeleted, 0),
            ),
          )
        if (!parent) throw new Error('Parent issue not found')
        if (parent.parentIssueId) throw new Error('Cannot nest deeper than 1 level')
      }

      const [maxNumRow] = await tx
        .select({ maxNum: max(issuesTable.issueNumber) })
        .from(issuesTable)
        .where(eq(issuesTable.projectId, project.id))
      const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

      const [lastItem] = await tx
        .select({ sortOrder: issuesTable.sortOrder })
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.projectId, project.id),
            eq(issuesTable.statusId, effectiveStatusId),
            eq(issuesTable.isDeleted, 0),
          ),
        )
        .orderBy(desc(issuesTable.sortOrder))
        .limit(1)
      const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

      return tx
        .insert(issuesTable)
        .values({
          projectId: project.id,
          statusId: effectiveStatusId,
          issueNumber,
          title,
          sortOrder,
          parentIssueId: parentIssueId ?? null,
          engineType: resolvedEngine,
          model: resolvedModel,
          sessionStatus: shouldExecute ? 'pending' : null,
          prompt: title,
        })
        .returning()
    })

    // Trigger execution if status is working
    if (shouldExecute) {
      const { triggerIssueExecution, parseProjectEnvVars } = await import('@/routes/issues/_shared')
      triggerIssueExecution(
        newIssue!.id,
        {
          engineType: resolvedEngine,
          prompt: title,
          model: resolvedModel,
        },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    return textResult(serializeIssue(newIssue!))
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

    const updates: Record<string, unknown> = {}
    if (title !== undefined) updates.title = title
    if (statusId !== undefined) {
      updates.statusId = statusId
      if (statusId !== existing.statusId) {
        updates.statusUpdatedAt = new Date()
      }
    }

    if (Object.keys(updates).length === 0) {
      return textResult(serializeIssue(existing))
    }

    // Handle working transition → trigger execution
    const transitioningToWorking = statusId === 'working' && existing.statusId !== 'working'
    const shouldExecute =
      transitioningToWorking && (!existing.sessionStatus || existing.sessionStatus === 'pending')

    if (shouldExecute) {
      updates.sessionStatus = 'pending'
    }

    const [row] = await db
      .update(issuesTable)
      .set(updates)
      .where(eq(issuesTable.id, issueId))
      .returning()

    if (shouldExecute) {
      const { triggerIssueExecution, parseProjectEnvVars } = await import('@/routes/issues/_shared')
      triggerIssueExecution(
        issueId,
        {
          engineType: existing.engineType,
          prompt: existing.prompt,
          model: existing.model,
        },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    // Cancel active processes when moving to done
    if (statusId === 'done' && existing.statusId !== 'done') {
      void issueEngine.cancelIssue(issueId).catch((err) => {
        logger.error({ issueId, err }, 'mcp_done_cancel_failed')
      })
    }

    return textResult(serializeIssue(row!))
  })

  server.registerTool('delete-issue', {
    title: 'Delete Issue',
    description: 'Soft-delete an issue.',
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

    await db.update(issuesTable).set({ isDeleted: 1 }).where(eq(issuesTable.id, issueId))
    return textResult({ deleted: true, id: issueId })
  })

  // ==================== Execution Tools ====================

  server.registerTool('execute-issue', {
    title: 'Execute Issue',
    description: 'Start AI engine execution on an issue. The issue must be in "working" or "review" status.',
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

    if (issue.statusId === 'todo' || issue.statusId === 'done') {
      return errorResult(`Cannot execute issue in "${issue.statusId}" status`)
    }

    try {
      const workingDir = project.directory || undefined
      const basePrompt = project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt
      const result = await issueEngine.executeIssue(issueId, {
        engineType: engineType as EngineType,
        prompt: basePrompt,
        workingDir,
        model,
      })
      return textResult({
        executionId: result.executionId,
        issueId,
        messageId: result.messageId,
      })
    } catch (error) {
      logger.error({ issueId, error }, 'mcp_execute_failed')
      return errorResult(`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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

    try {
      const result = await issueEngine.followUpIssue(issueId, prompt, model)
      return textResult({
        executionId: result.executionId,
        issueId,
        messageId: result.messageId,
      })
    } catch (error) {
      logger.error({ issueId, error }, 'mcp_followup_failed')
      return errorResult(`Follow-up failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      return errorResult(`Cancel failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })

  server.registerTool('restart-issue', {
    title: 'Restart Issue',
    description: 'Restart a failed AI session on an issue.',
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
      const result = await issueEngine.restartIssue(issueId)
      return textResult({ executionId: result.executionId, issueId })
    } catch (error) {
      return errorResult(`Restart failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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

    const { issueLogs } = await import('@/db/schema')
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
