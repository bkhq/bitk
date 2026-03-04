import { zValidator } from '@hono/zod-validator'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as z from 'zod'
import { db } from '@/db'
import { notes } from '@/db/schema'

const notesRoutes = new Hono()

const validationError = (
  result: { success: false; error: z.ZodError },
  c: any,
) =>
  c.json(
    {
      success: false,
      error: result.error.issues.map((i: z.ZodIssue) => i.message).join(', '),
    },
    400,
  )

// GET /api/notes
notesRoutes.get('/', async (c) => {
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.isDeleted, 0))
    .orderBy(desc(notes.updatedAt))
  return c.json({ success: true, data: rows })
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
    (result, c) => {
      if (!result.success) return validationError(result, c)
    },
  ),
  async (c) => {
    const { title, content } = c.req.valid('json')
    const [row] = await db.insert(notes).values({ title, content }).returning()
    return c.json({ success: true, data: row }, 201)
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
    }),
    (result, c) => {
      if (!result.success) return validationError(result, c)
    },
  ),
  async (c) => {
    const id = c.req.param('id')
    const data = c.req.valid('json')
    const [row] = await db
      .update(notes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404)
    }
    return c.json({ success: true, data: row })
  },
)

// DELETE /api/notes/:id (soft delete)
notesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db
    .update(notes)
    .set({ isDeleted: 1, updatedAt: new Date() })
    .where(eq(notes.id, id))
    .returning()
  if (!row) {
    return c.json({ success: false, error: 'Note not found' }, 404)
  }
  return c.json({ success: true, data: { id } })
})

export default notesRoutes
