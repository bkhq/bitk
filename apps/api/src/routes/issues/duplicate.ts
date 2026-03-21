import { and, asc, desc, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { ulid } from 'ulid'
import { cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const duplicate = new Hono()

// POST /api/projects/:projectId/issues/:id/duplicate — Duplicate an issue
duplicate.post('/:id/duplicate', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const source = await getProjectOwnedIssue(project.id, issueId)
  if (!source) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  const [newIssue] = await db.transaction(async (tx) => {
    // Compute next issueNumber
    const [maxNumRow] = await tx
      .select({ maxNum: max(issuesTable.issueNumber) })
      .from(issuesTable)
      .where(eq(issuesTable.projectId, project.id))
    const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

    // Compute sortOrder: place after the last item in todo column
    const [lastItem] = await tx
      .select({ sortOrder: issuesTable.sortOrder })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.statusId, 'todo'),
          eq(issuesTable.isDeleted, 0),
        ),
      )
      .orderBy(desc(issuesTable.sortOrder))
      .limit(1)
    const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

    // Create the new issue
    const [created] = await tx
      .insert(issuesTable)
      .values({
        projectId: project.id,
        statusId: 'todo',
        issueNumber,
        title: source.title,
        tag: source.tag,
        sortOrder,
        useWorktree: source.useWorktree,
        engineType: source.engineType,
        model: source.model,
        prompt: source.prompt,
      })
      .returning()

    if (!created) return []

    // Copy only user and assistant message logs (no tool calls)
    const sourceLogs = await tx
      .select()
      .from(logsTable)
      .where(
        and(
          eq(logsTable.issueId, issueId),
          eq(logsTable.visible, 1),
        ),
      )
      .orderBy(asc(logsTable.id))

    const messageLogs = sourceLogs.filter(
      log => log.entryType === 'user-message' || log.entryType === 'assistant-message',
    )

    if (messageLogs.length > 0) {
      const logIdMap = new Map<string, string>()
      const now = new Date()

      for (const log of messageLogs) {
        const newLogId = ulid()
        logIdMap.set(log.id, newLogId)

        await tx.insert(logsTable).values({
          id: newLogId,
          issueId: created.id,
          turnIndex: log.turnIndex,
          entryIndex: log.entryIndex,
          entryType: log.entryType,
          content: log.content,
          metadata: log.metadata,
          replyToMessageId: log.replyToMessageId ? (logIdMap.get(log.replyToMessageId) ?? log.replyToMessageId) : null,
          timestamp: log.timestamp,
          toolCallRefId: null,
          visible: log.visible,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    return [created]
  })

  await cacheDelByPrefix(`projectIssueIds:${project.id}`)

  if (!newIssue) {
    return c.json({ success: false, error: 'Failed to create issue' }, 500)
  }

  return c.json({ success: true, data: serializeIssue(newIssue) }, 201)
})

export default duplicate
