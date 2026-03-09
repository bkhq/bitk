import type { NotificationChannel, WebhookEventType } from '@bkd/shared'
import { NOTIFICATION_CHANNELS, WEBHOOK_EVENT_TYPES } from '@bkd/shared'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import * as z from 'zod'
import { db } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { deliver } from '@/webhooks/dispatcher'

const webhooksRoute = new Hono()

function isPrivateHost(hostname: string): boolean {
  // Loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  // IPv4 private ranges
  if (/^10\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  // Link-local
  if (/^169\.254\./.test(hostname)) return true
  // Cloud metadata
  if (hostname === '169.254.169.254') return true
  // IPv6 private/link-local
  if (/^fe80:/i.test(hostname) || /^fc00:/i.test(hostname) || /^fd/i.test(hostname)) return true
  // Catch-all for 0.0.0.0
  if (hostname === '0.0.0.0') return true
  return false
}

const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'

function serializeWebhook(row: typeof webhooks.$inferSelect) {
  let events: WebhookEventType[] = []
  try {
    events = JSON.parse(row.events) as WebhookEventType[]
  } catch {
    events = []
  }

  return {
    id: row.id,
    channel: row.channel as NotificationChannel,
    url: row.url,
    secret: row.secret ? SECRET_MASK : null,
    events,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const eventsArray = z.array(z.enum(WEBHOOK_EVENT_TYPES as [string, ...string[]])).min(1)

const createSchema = z
  .object({
    channel: z
      .enum(NOTIFICATION_CHANNELS as [string, ...string[]])
      .optional()
      .default('webhook'),
    url: z.string().min(1),
    secret: z.string().max(256).optional(),
    events: eventsArray,
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.channel === 'webhook') {
      try {
        const parsed = new URL(data.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['url'],
            message: 'URL must use http or https protocol',
          })
        }
        // Block private/internal network hostnames
        const host = parsed.hostname.toLowerCase()
        if (isPrivateHost(host)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['url'],
            message: 'URLs pointing to private/internal networks are not allowed',
          })
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['url'],
          message: 'Invalid URL format',
        })
      }
    } else if (data.channel === 'telegram') {
      if (!data.secret || data.secret.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secret'],
          message: 'Bot token is required for Telegram',
        })
      }
      if (!/^-?\d+$/.test(data.url.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['url'],
          message: 'Chat ID must be a numeric value',
        })
      }
    }
  })

const updateSchema = z.object({
  url: z.string().min(1).optional(),
  secret: z.string().max(256).nullable().optional(),
  events: eventsArray.optional(),
  isActive: z.boolean().optional(),
})

// GET /api/settings/webhooks
webhooksRoute.get('/webhooks', async (c) => {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.isDeleted, 0))
    .orderBy(desc(webhooks.createdAt))

  return c.json({ success: true, data: rows.map(serializeWebhook) })
})

// POST /api/settings/webhooks
webhooksRoute.post(
  '/webhooks',
  zValidator('json', createSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const body = c.req.valid('json')

    const [row] = await db
      .insert(webhooks)
      .values({
        channel: body.channel ?? 'webhook',
        url: body.url,
        secret: body.secret ?? null,
        events: JSON.stringify(body.events),
        isActive: body.isActive ?? true,
      })
      .returning()

    return c.json({ success: true, data: serializeWebhook(row!) }, 201)
  },
)

// PATCH /api/settings/webhooks/:id
webhooksRoute.patch(
  '/webhooks/:id',
  zValidator('json', updateSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const id = c.req.param('id')!
    const [existing] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.isDeleted, 0)))

    if (!existing) {
      return c.json({ success: false, error: 'Webhook not found' }, 404)
    }

    const body = c.req.valid('json')

    // Validate channel-specific rules against effective (merged) values
    // Channel is immutable after creation — always use existing value
    const effectiveChannel = existing.channel
    const effectiveUrl = body.url ?? existing.url
    const effectiveSecret
      = body.secret !== undefined && body.secret !== SECRET_MASK ? body.secret : existing.secret

    if (effectiveChannel === 'webhook' && body.url !== undefined) {
      try {
        const parsed = new URL(effectiveUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return c.json({ success: false, error: 'URL must use http or https protocol' }, 400)
        }
        if (isPrivateHost(parsed.hostname.toLowerCase())) {
          return c.json(
            {
              success: false,
              error: 'URLs pointing to private/internal networks are not allowed',
            },
            400,
          )
        }
      } catch {
        return c.json({ success: false, error: 'Invalid URL format' }, 400)
      }
    }
    if (effectiveChannel === 'telegram') {
      if (!effectiveSecret) {
        return c.json({ success: false, error: 'Bot token is required for Telegram' }, 400)
      }
      if (body.url !== undefined && !/^-?\d+$/.test(effectiveUrl.trim())) {
        return c.json({ success: false, error: 'Chat ID must be a numeric value' }, 400)
      }
    }

    const updates: Record<string, unknown> = {}

    if (body.url !== undefined) updates.url = body.url
    // Skip masked secret (means "unchanged"); null means "clear"; otherwise set new value
    if (body.secret !== undefined && body.secret !== SECRET_MASK) {
      updates.secret = body.secret
    }
    if (body.events !== undefined) updates.events = JSON.stringify(body.events)
    if (body.isActive !== undefined) updates.isActive = body.isActive

    if (Object.keys(updates).length === 0) {
      return c.json({ success: true, data: serializeWebhook(existing) })
    }

    const [updated] = await db.update(webhooks).set(updates).where(eq(webhooks.id, id)).returning()

    return c.json({ success: true, data: serializeWebhook(updated!) })
  },
)

// DELETE /api/settings/webhooks/:id
webhooksRoute.delete('/webhooks/:id', async (c) => {
  const id = c.req.param('id')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  await db.update(webhooks).set({ isDeleted: 1 }).where(eq(webhooks.id, id))

  return c.json({ success: true, data: { id } })
})

// GET /api/settings/webhooks/:id/deliveries
webhooksRoute.get('/webhooks/:id/deliveries', async (c) => {
  const id = c.req.param('id')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50)

  return c.json({
    success: true,
    data: rows.map(r => ({
      id: r.id,
      webhookId: r.webhookId,
      event: r.event,
      payload: r.payload,
      statusCode: r.statusCode,
      response: r.response,
      success: r.success,
      duration: r.duration,
      createdAt: r.createdAt.toISOString(),
    })),
  })
})

// POST /api/settings/webhooks/:id/test — delivers only to the target webhook
webhooksRoute.post('/webhooks/:id/test', async (c) => {
  const id = c.req.param('id')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  await deliver(
    {
      id: existing.id,
      channel: existing.channel,
      url: existing.url,
      secret: existing.secret,
      events: existing.events,
      isActive: existing.isActive,
    },
    'issue.updated',
    {
      event: 'issue.updated',
      issueId: 'test',
      changes: { title: 'Webhook test' },
      timestamp: new Date().toISOString(),
      test: true,
    },
  )

  return c.json({ success: true, data: { sent: true } })
})

export default webhooksRoute
