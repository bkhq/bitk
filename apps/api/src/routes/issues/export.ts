import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import * as z from 'zod'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { isVisible } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { rawToToolAction } from '@/engines/issue/persistence/tool-detail'
import { getProjectOwnedIssue } from './_shared'

const exportRoute = new Hono()

function getAllLogs(issueId: string): NormalizedLogEntry[] {
  const rows = db
    .select()
    .from(logsTable)
    .where(and(eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)))
    .orderBy(asc(logsTable.id))
    .all()

  const toolByLogId = new Map<string, (typeof toolsTable)['$inferSelect']>()
  if (rows.length > 0) {
    const logIds = rows.map(r => r.id)
    // Batch in chunks of 500 to avoid SQLite variable limits
    for (let i = 0; i < logIds.length; i += 500) {
      const chunk = logIds.slice(i, i + 500)
      const toolRows = db.select().from(toolsTable).where(inArray(toolsTable.logId, chunk)).all()
      for (const r of toolRows) toolByLogId.set(r.logId, r)
    }
  }

  return rows
    .map((row) => {
      const parsedMeta = row.metadata ? JSON.parse(row.metadata) : undefined
      const base: NormalizedLogEntry = {
        messageId: row.id,
        replyToMessageId: row.replyToMessageId ?? undefined,
        entryType: row.entryType as NormalizedLogEntry['entryType'],
        content: row.content.trim(),
        turnIndex: row.turnIndex,
        timestamp: row.timestamp ?? undefined,
        metadata: parsedMeta,
      }

      const tool = toolByLogId.get(row.id)
      if (tool) {
        const rawData = tool.raw ? JSON.parse(tool.raw) : {}
        base.toolDetail = {
          kind: tool.kind,
          toolName: tool.toolName,
          toolCallId: tool.toolCallId ?? undefined,
          isResult: tool.isResult ?? false,
          raw: rawData,
        }
        base.toolAction = rawToToolAction(tool.kind, rawData)
        if (!base.content && rawData.content) {
          base.content = rawData.content as string
        }
        if (!base.metadata && rawData.metadata) {
          base.metadata = rawData.metadata as Record<string, unknown>
        }
      }

      return base
    })
    .filter(isVisible)
}

const exportQuerySchema = z.object({
  format: z.enum(['json']).default('json'),
})

// GET /api/projects/:projectId/issues/:id/export — Export issue logs
exportRoute.get('/:id/export', zValidator('query', exportQuerySchema), async (c) => {
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

  const logs = getAllLogs(issueId)
  const filename = `issue-${issue.issueNumber}-${issue.id}`

  const json = JSON.stringify({ issue: { id: issue.id, title: issue.title, issueNumber: issue.issueNumber }, logs }, null, 2)
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
    },
  })
})

export default exportRoute
