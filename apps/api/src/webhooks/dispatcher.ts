import type { WebhookEventType } from '@bkd/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'

interface WebhookRow {
  id: string
  channel: string
  url: string
  secret: string | null
  events: string
  isActive: boolean
}

function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatTelegramMessage(
  event: WebhookEventType,
  payload: Record<string, unknown>,
): string {
  const emoji: Record<string, string> = {
    'issue.created': '\u{1F4DD}',
    'issue.updated': '\u{270F}\u{FE0F}',
    'issue.deleted': '\u{1F5D1}',
    'issue.status_changed': '\u{1F504}',
    'session.started': '\u{25B6}\u{FE0F}',
    'session.completed': '\u{2705}',
    'session.failed': '\u{274C}',
  }
  const icon = emoji[event] ?? '\u{1F4CC}'
  const lines = [`${icon} <b>${escapeTelegramHtml(event)}</b>`]

  if (payload.issueId)
    lines.push(
      `Issue: <code>${escapeTelegramHtml(String(payload.issueId))}</code>`,
    )
  if (payload.title)
    lines.push(`Title: ${escapeTelegramHtml(String(payload.title))}`)
  if (payload.finalStatus)
    lines.push(`Status: ${escapeTelegramHtml(String(payload.finalStatus))}`)
  if (payload.statusId)
    lines.push(`Status: ${escapeTelegramHtml(String(payload.statusId))}`)
  if (payload.changes && typeof payload.changes === 'object') {
    const keys = Object.keys(payload.changes as Record<string, unknown>)
    if (keys.length > 0)
      lines.push(`Changed: ${escapeTelegramHtml(keys.join(', '))}`)
  }

  return lines.join('\n')
}

async function deliverWebhook(
  webhook: WebhookRow,
  event: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<{
  statusCode: number | null
  response: string | null
  success: boolean
}> {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': event,
  }
  if (webhook.secret) {
    headers.Authorization = `Bearer ${webhook.secret}`
  }

  const res = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const response = (await res.text()).slice(0, 1024)
  return { statusCode: res.status, response, success: res.ok }
}

async function deliverTelegram(
  webhook: WebhookRow,
  event: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<{
  statusCode: number | null
  response: string | null
  success: boolean
}> {
  const botToken = webhook.secret
  const chatId = webhook.url
  if (!botToken || !chatId) {
    return {
      statusCode: null,
      response: 'Missing bot token or chat ID',
      success: false,
    }
  }

  const text = formatTelegramMessage(event, payload)
  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const response = (await res.text()).slice(0, 1024)
  return { statusCode: res.status, response, success: res.ok }
}

export async function deliver(
  webhook: WebhookRow,
  event: WebhookEventType,
  payload: Record<string, unknown>,
) {
  const start = Date.now()
  let result: {
    statusCode: number | null
    response: string | null
    success: boolean
  }

  try {
    result =
      webhook.channel === 'telegram'
        ? await deliverTelegram(webhook, event, payload)
        : await deliverWebhook(webhook, event, payload)
  } catch (err) {
    result = {
      statusCode: null,
      response: err instanceof Error ? err.message : String(err),
      success: false,
    }
  }

  const duration = Date.now() - start

  try {
    await db.insert(webhookDeliveries).values({
      webhookId: webhook.id,
      event,
      payload: JSON.stringify(payload),
      statusCode: result.statusCode,
      response: result.response,
      success: result.success,
      duration,
    })
  } catch (err) {
    logger.warn({ err, webhookId: webhook.id }, 'webhook_delivery_log_failed')
  }
}

export async function dispatch(
  event: WebhookEventType,
  payload: Record<string, unknown>,
) {
  let rows: WebhookRow[]
  try {
    rows = await db
      .select({
        id: webhooks.id,
        channel: webhooks.channel,
        url: webhooks.url,
        secret: webhooks.secret,
        events: webhooks.events,
        isActive: webhooks.isActive,
      })
      .from(webhooks)
      .where(and(eq(webhooks.isActive, true), eq(webhooks.isDeleted, 0)))
  } catch (err) {
    logger.warn({ err }, 'webhook_query_failed')
    return
  }

  for (const row of rows) {
    let subscribed: string[]
    try {
      subscribed = JSON.parse(row.events)
    } catch {
      continue
    }
    if (!subscribed.includes(event)) continue

    // Fire and forget — don't block the event bus
    void deliver(row, event, payload).catch((err) => {
      logger.warn({ err, webhookId: row.id, event }, 'webhook_deliver_error')
    })
  }
}

export function initWebhookDispatcher() {
  // Issue lifecycle events — dispatch status_changed OR updated, not both
  appEvents.on(
    'issue-updated',
    (data) => {
      const changes = data.changes as Record<string, unknown>

      if (changes.statusId) {
        // Fire status_changed instead of updated when status changes
        void dispatch('issue.status_changed', {
          event: 'issue.status_changed',
          issueId: data.issueId,
          changes,
          timestamp: new Date().toISOString(),
        })
      } else {
        void dispatch('issue.updated', {
          event: 'issue.updated',
          issueId: data.issueId,
          changes,
          timestamp: new Date().toISOString(),
        })
      }
    },
    { order: 200 },
  )

  // Session completion events
  appEvents.on(
    'done',
    (data) => {
      const event: WebhookEventType =
        data.finalStatus === 'completed'
          ? 'session.completed'
          : 'session.failed'

      void dispatch(event, {
        event,
        issueId: data.issueId,
        executionId: data.executionId,
        finalStatus: data.finalStatus,
        timestamp: new Date().toISOString(),
      })
    },
    { order: 200 },
  )

  // Session started
  appEvents.on(
    'state',
    (data) => {
      if (data.state === 'running') {
        void dispatch('session.started', {
          event: 'session.started',
          issueId: data.issueId,
          executionId: data.executionId,
          timestamp: new Date().toISOString(),
        })
      }
    },
    { order: 200 },
  )

  logger.info('webhook_dispatcher_initialized')
}

// Cleanup old deliveries (keep last 100 per webhook)
export async function cleanupDeliveries() {
  try {
    const allWebhooks = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(eq(webhooks.isDeleted, 0))

    for (const wh of allWebhooks) {
      const rows = await db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, wh.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .offset(100)

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id)
        await db
          .delete(webhookDeliveries)
          .where(inArray(webhookDeliveries.id, ids))
      }
    }
  } catch (err) {
    logger.warn({ err }, 'webhook_delivery_cleanup_failed')
  }
}

// Start periodic delivery cleanup (every 1h)
export function startDeliveryCleanup(intervalMs = 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    void cleanupDeliveries().catch((err) => {
      logger.warn({ err }, 'webhook_delivery_cleanup_error')
    })
  }, intervalMs)
  if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref()
  return () => clearInterval(timer)
}
