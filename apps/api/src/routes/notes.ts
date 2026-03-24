import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { notes } from '@/db/schema'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const notesRoutes = createOpenAPIRouter()

const notDeleted = eq(notes.isDeleted, 0)

// GET /api/notes
notesRoutes.openapi(R.listNotes, async (c) => {
  try {
    const rows = await db
      .select()
      .from(notes)
      .where(notDeleted)
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
    return c.json({ success: true, data: rows }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_list_failed')
    return c.json({ success: false, error: 'Failed to list notes' }, 500 as const)
  }
})

// POST /api/notes
notesRoutes.openapi(R.createNote, async (c) => {
  try {
    const { title, content } = c.req.valid('json')
    const [row] = await db.insert(notes).values({ title, content }).returning()
    return c.json({ success: true, data: row }, 201 as const)
  } catch (err) {
    logger.error({ err }, 'notes_create_failed')
    return c.json({ success: false, error: 'Failed to create note' }, 500 as const)
  }
})

// PATCH /api/notes/:noteId
notesRoutes.openapi(R.updateNote, async (c) => {
  try {
    const noteId = c.req.param('noteId')
    const data = c.req.valid('json')
    const [row] = await db
      .update(notes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), notDeleted))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404 as const)
    }
    return c.json({ success: true, data: row }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_update_failed')
    return c.json({ success: false, error: 'Failed to update note' }, 500 as const)
  }
})

// DELETE /api/notes/:noteId (soft delete)
notesRoutes.openapi(R.deleteNote, async (c) => {
  try {
    const noteId = c.req.param('noteId')
    const [row] = await db
      .update(notes)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), notDeleted))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404 as const)
    }
    return c.json({ success: true, data: { id: noteId } }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_delete_failed')
    return c.json({ success: false, error: 'Failed to delete note' }, 500 as const)
  }
})

export default notesRoutes
