import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../../db'
import { findProject } from '../../db/helpers'
import { attachments } from '../../db/schema'
import { UPLOAD_DIR } from '../../uploads'
import { getProjectOwnedIssue } from './_shared'

const attachmentsRouter = new Hono()

// GET /api/projects/:projectId/issues/:id/attachments/:attachmentId — Serve attachment file
attachmentsRouter.get('/:id/attachments/:attachmentId', async (c) => {
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

  const attachmentId = c.req.param('attachmentId')!
  const [attachment] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.issueId, issueId)))
  if (!attachment) {
    return c.json({ success: false, error: 'Attachment not found' }, 404)
  }

  const filePath = resolve(process.cwd(), attachment.storagePath)

  // SEC-025: Prevent path traversal — resolved path must be inside the uploads directory
  if (!filePath.startsWith(UPLOAD_DIR)) {
    return c.json({ success: false, error: 'Invalid attachment path' }, 400)
  }

  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return c.json({ success: false, error: 'Attachment file missing' }, 404)
  }

  return new Response(file.stream(), {
    headers: {
      'Content-Type': attachment.mimeType,
      // SEC-024: Force download to prevent content-sniffing and XSS via served files
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    },
  })
})

export default attachmentsRouter
