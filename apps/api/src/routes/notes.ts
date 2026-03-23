import { zValidator } from '@hono/zod-validator'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as z from 'zod'
import { db } from '@/db'
import { notes } from '@/db/schema'
import { logger } from '@/logger'

const notesRoutes = new Hono()

const notDeleted = eq(notes.isDeleted, 0)

// GET /api/notes
notesRoutes.get('/', async (c) => {
  try {
    const rows = await db
      .select()
      .from(notes)
      .where(notDeleted)
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
    return c.json({ success: true, data: rows })
  } catch (err) {
    logger.error({ err }, 'notes_list_failed')
    return c.json({ success: false, error: 'Failed to list notes' }, 500)
  }
})

// POST /api/notes
notesRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      title: z.string().max(500).optional().default(''),
      content: z.string().max(100_000).optional().default(''),
    }),
  ),
  async (c) => {
    try {
      const { title, content } = c.req.valid('json')
      const [row] = await db.insert(notes).values({ title, content }).returning()
      return c.json({ success: true, data: row }, 201)
    } catch (err) {
      logger.error({ err }, 'notes_create_failed')
      return c.json({ success: false, error: 'Failed to create note' }, 500)
    }
  },
)

// PATCH /api/notes/:id
notesRoutes.patch(
  '/:id',
  zValidator(
    'json',
    z.object({
      title: z.string().max(500).optional(),
      content: z.string().max(100_000).optional(),
      isPinned: z.boolean().optional(),
    }),
  ),
  async (c) => {
    try {
      const id = c.req.param('id')
      const data = c.req.valid('json')
      const [row] = await db
        .update(notes)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(notes.id, id), notDeleted))
        .returning()
      if (!row) {
        return c.json({ success: false, error: 'Note not found' }, 404)
      }
      return c.json({ success: true, data: row })
    } catch (err) {
      logger.error({ err }, 'notes_update_failed')
      return c.json({ success: false, error: 'Failed to update note' }, 500)
    }
  },
)

// DELETE /api/notes/:id (soft delete)
notesRoutes.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const [row] = await db
      .update(notes)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(and(eq(notes.id, id), notDeleted))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404)
    }
    return c.json({ success: true, data: { id } })
  } catch (err) {
    logger.error({ err }, 'notes_delete_failed')
    return c.json({ success: false, error: 'Failed to delete note' }, 500)
  }
})

export default notesRoutes
