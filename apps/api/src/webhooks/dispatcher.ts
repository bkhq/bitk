import type { WebhookEventType } from '@bkd/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { getServerUrl } from '@/db/helpers'
import {
  issueLogs,
  issues as issuesTable,
  projects as projectsTable,
  webhookDeliveries,
  webhooks,
} from '@/db/schema'
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

// ── Helpers ──────────────────────────────────────────────

interface IssueMetadata {
  issueId: string
  issueNumber: number
  title: string
  projectId: string
  projectName: string
  engineType: string | null
  model: string | null
  issueUrl?: string
}

async function getIssueMetadata(issueId: string): Promise<IssueMetadata | null> {
  try {
    const [row] = await db
      .select({
        id: issuesTable.id,
        issueNumber: issuesTable.issueNumber,
        title: issuesTable.title,
        projectId: issuesTable.projectId,
        engineType: issuesTable.engineType,
        model: issuesTable.model,
        projectName: projectsTable.name,
      })
      .from(issuesTable)
      .leftJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
      .where(eq(issuesTable.id, issueId))
    if (!row) return null

    const result: IssueMetadata = {
      issueId: row.id,
      issueNumber: row.issueNumber,
      title: row.title,
      projectId: row.projectId,
      projectName: row.projectName ?? row.projectId,
      engineType: row.engineType,
      model: row.model,
    }

    const serverUrl = await getServerUrl()
    if (serverUrl) {
      result.issueUrl = buildIssueUrl(serverUrl, row.projectId, row.id)
    }

    return result
  } catch (err) {
    logger.warn({ err, issueId }, 'webhook_get_issue_metadata_failed')
    return null
  }
}

export function buildIssueUrl(serverUrl: string, projectId: string, issueId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/projects/${projectId}/issues/${issueId}`
}

async function getLastAgentLog(issueId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ content: issueLogs.content })
      .from(issueLogs)
      .where(
        and(
          eq(issueLogs.issueId, issueId),
          eq(issueLogs.entryType, 'assistant-message'),
          eq(issueLogs.isDeleted, 0),
        ),
      )
      .orderBy(desc(issueLogs.createdAt))
      .limit(1)
    if (!row?.content) return null
    return row.content.length > 500 ? `${row.content.slice(0, 500)}...` : row.content
  } catch (err) {
    logger.warn({ err, issueId }, 'webhook_get_last_log_failed')
    return null
  }
}

function buildMetadataPayload(meta: IssueMetadata): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    issueId: meta.issueId,
    issueNumber: meta.issueNumber,
    projectId: meta.projectId,
    projectName: meta.projectName,
    title: meta.title,
  }
  if (meta.issueUrl) payload.issueUrl = meta.issueUrl
  return payload
}

// ── Telegram formatting ─────────────────────────────────

function escapeTelegramHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTelegramMessage(event: WebhookEventType, payload: Record<string, unknown>): string {
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

  // Project
  if (payload.projectName) lines.push(`Project: ${escapeTelegramHtml(String(payload.projectName))}`)

  // Issue line: #number title (with link if available)
  const issueNumber = payload.issueNumber
  const title = payload.title ? String(payload.title) : null
  const issueUrl = payload.issueUrl ? String(payload.issueUrl) : null
  if (issueNumber && title) {
    const label = `#${issueNumber} ${escapeTelegramHtml(title)}`
    lines.push(`Issue: ${label}`)
  }

  // Status info
  if (payload.newStatus) {
    let statusLine = `Status: → ${escapeTelegramHtml(String(payload.newStatus))}`
    if (payload.newStatus === 'review') {
      statusLine += ' (session completed)'
    }
    lines.push(statusLine)
  } else if (payload.statusId) {
    lines.push(`Status: ${escapeTelegramHtml(String(payload.statusId))}`)
  }

  // Engine + model for session/create events
  if (payload.engineType) {
    let engineLine = `Engine: ${escapeTelegramHtml(String(payload.engineType))}`
    if (payload.model) engineLine += ` | Model: ${escapeTelegramHtml(String(payload.model))}`
    lines.push(engineLine)
  }

  // Changed fields for issue.updated
  if (payload.changes && typeof payload.changes === 'object') {
    const keys = Object.keys(payload.changes as Record<string, unknown>)
    if (keys.length > 0) lines.push(`Changed: ${escapeTelegramHtml(keys.join(', '))}`)
  }

  // Last log for session.failed
  if (payload.lastLog) {
    lines.push('')
    lines.push(`\u{1F4AC} ${escapeTelegramHtml(String(payload.lastLog))}`)
  }

  // Link
  if (issueUrl) {
    lines.push(`\u{1F517} <a href="${escapeTelegramHtml(issueUrl)}">Open</a>`)
  }

  return lines.join('\n')
}

// ── Delivery ────────────────────────────────────────────

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

export async function dispatch(event: WebhookEventType, payload: Record<string, unknown>) {
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

// ── Event listeners ─────────────────────────────────────

export function initWebhookDispatcher() {
  // Issue lifecycle events — dispatch status_changed OR updated, not both
  appEvents.on(
    'issue-updated',
    (data) => {
      const changes = data.changes as Record<string, unknown>

      if (changes.statusId) {
        const newStatus = String(changes.statusId)
        // Only notify for meaningful status changes: todo, review, done
        if (!['todo', 'review', 'done'].includes(newStatus)) return

        void (async () => {
          try {
            const meta = await getIssueMetadata(data.issueId)
            const payload: Record<string, unknown> = {
              event: 'issue.status_changed',
              timestamp: new Date().toISOString(),
              ...(meta ? buildMetadataPayload(meta) : { issueId: data.issueId }),
              newStatus,
            }
            await dispatch('issue.status_changed', payload)
          } catch (err) {
            logger.warn({ err, issueId: data.issueId }, 'webhook_status_changed_failed')
          }
        })()
      } else {
        void (async () => {
          try {
            const meta = await getIssueMetadata(data.issueId)
            await dispatch('issue.updated', {
              event: 'issue.updated',
              timestamp: new Date().toISOString(),
              ...(meta ? buildMetadataPayload(meta) : { issueId: data.issueId }),
              changes,
            })
          } catch (err) {
            logger.warn({ err, issueId: data.issueId }, 'webhook_updated_failed')
          }
        })()
      }
    },
    { order: 200 },
  )

  // Session completion events
  appEvents.on(
    'done',
    (data) => {
      void (async () => {
        try {
          const eventType: WebhookEventType =
            data.finalStatus === 'completed' ? 'session.completed' : 'session.failed'

          const meta = await getIssueMetadata(data.issueId)
          const payload: Record<string, unknown> = {
            event: eventType,
            timestamp: new Date().toISOString(),
            ...(meta ? buildMetadataPayload(meta) : { issueId: data.issueId }),
            executionId: data.executionId,
            finalStatus: data.finalStatus,
          }

          if (meta?.engineType) payload.engineType = meta.engineType
          if (meta?.model) payload.model = meta.model

          // Attach last agent log for failed sessions
          if (eventType === 'session.failed') {
            const lastLog = await getLastAgentLog(data.issueId)
            if (lastLog) payload.lastLog = lastLog
          }

          await dispatch(eventType, payload)
        } catch (err) {
          logger.warn({ err, issueId: data.issueId }, 'webhook_done_failed')
        }
      })()
    },
    { order: 200 },
  )

  // Session started
  appEvents.on(
    'state',
    (data) => {
      if (data.state === 'running') {
        void (async () => {
          try {
            const meta = await getIssueMetadata(data.issueId)
            const payload: Record<string, unknown> = {
              event: 'session.started',
              timestamp: new Date().toISOString(),
              ...(meta ? buildMetadataPayload(meta) : { issueId: data.issueId }),
              executionId: data.executionId,
            }
            if (meta?.engineType) payload.engineType = meta.engineType
            if (meta?.model) payload.model = meta.model

            await dispatch('session.started', payload)
          } catch (err) {
            logger.warn({ err, issueId: data.issueId }, 'webhook_state_failed')
          }
        })()
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
        await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, ids))
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
