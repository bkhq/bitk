import type { NotificationChannel, WebhookEventType } from '@bkd/shared'
import { WEBHOOK_EVENT_TYPES } from '@bkd/shared'
import {
  BotMessageSquare,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Globe,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '@/hooks/use-kanban'
import { cn } from '@/lib/utils'
import type { Webhook } from '@/types/kanban'

const EVENT_LABEL_KEYS: Record<WebhookEventType, string> = {
  'issue.created': 'settings.webhooksEventIssueCreated',
  'issue.updated': 'settings.webhooksEventIssueUpdated',
  'issue.deleted': 'settings.webhooksEventIssueDeleted',
  'issue.status_changed': 'settings.webhooksEventIssueStatusChanged',
  'session.started': 'settings.webhooksEventSessionStarted',
  'session.completed': 'settings.webhooksEventSessionCompleted',
  'session.failed': 'settings.webhooksEventSessionFailed',
}

export function WebhookSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: webhooks, isLoading } = useWebhooks(open)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('settings.webhooksHint')}</p>
        {!showForm && !editingId && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 size-3.5" />
            {t('settings.webhooksAdd')}
          </Button>
        )}
      </div>

      {showForm && <WebhookForm onClose={() => setShowForm(false)} />}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks && webhooks.length > 0 ? (
        <div className="space-y-2">
          {webhooks.map((webhook) => (
            <div key={webhook.id}>
              {editingId === webhook.id ? (
                <WebhookForm webhook={webhook} onClose={() => setEditingId(null)} />
              ) : (
                <WebhookCard
                  webhook={webhook}
                  isExpanded={expandedId === webhook.id}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === webhook.id ? null : webhook.id)
                  }
                  onEdit={() => setEditingId(webhook.id)}
                />
              )}
            </div>
          ))}
        </div>
      ) : !showForm ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('settings.webhooksEmpty')}
        </div>
      ) : null}
    </div>
  )
}

const CHANNEL_OPTIONS: {
  value: NotificationChannel
  icon: typeof Globe
  labelKey: string
}[] = [
  {
    value: 'webhook',
    icon: Globe,
    labelKey: 'settings.webhooksChannelWebhook',
  },
  {
    value: 'telegram',
    icon: BotMessageSquare,
    labelKey: 'settings.webhooksChannelTelegram',
  },
]

function WebhookForm({ webhook, onClose }: { webhook?: Webhook; onClose: () => void }) {
  const { t } = useTranslation()
  const createWebhook = useCreateWebhook()
  const updateWebhook = useUpdateWebhook()

  const [channel, setChannel] = useState<NotificationChannel>(webhook?.channel ?? 'webhook')
  const [url, setUrl] = useState(webhook?.url ?? '')
  const [secret, setSecret] = useState(webhook?.secret ?? '')
  const [events, setEvents] = useState<WebhookEventType[]>(
    webhook?.events ?? [...WEBHOOK_EVENT_TYPES],
  )
  const [isActive, setIsActive] = useState(webhook?.isActive ?? true)

  const isEditing = !!webhook
  const isPending = createWebhook.isPending || updateWebhook.isPending
  const isTelegram = channel === 'telegram'

  const toggleEvent = useCallback((event: WebhookEventType) => {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]))
  }, [])

  const handleSubmit = () => {
    if (!url || (!secret && isTelegram) || events.length === 0) return

    if (isEditing) {
      updateWebhook.mutate(
        {
          id: webhook.id,
          url,
          secret: secret || null,
          events,
          isActive,
        },
        { onSuccess: onClose },
      )
    } else {
      createWebhook.mutate(
        { channel, url, secret: secret || undefined, events, isActive },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t('settings.webhooksChannelType')}</Label>
        {isEditing ? (
          <div className="flex gap-1.5">
            {(() => {
              const opt = CHANNEL_OPTIONS.find((o) => o.value === channel) ?? CHANNEL_OPTIONS[0]
              const Icon = opt.icon
              return (
                <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary gap-1.5">
                  <Icon className="size-3.5" />
                  {t(opt.labelKey)}
                </span>
              )
            })()}
          </div>
        ) : (
          <div className="flex gap-1.5">
            {CHANNEL_OPTIONS.map((opt) => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setChannel(opt.value)}
                  className={cn(
                    'inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors cursor-pointer gap-1.5',
                    channel === opt.value
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" />
                  {t(opt.labelKey)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {isTelegram ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.webhooksTelegramBotToken')}</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t('settings.webhooksTelegramBotTokenPlaceholder')}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('settings.webhooksTelegramBotTokenHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.webhooksTelegramChatId')}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('settings.webhooksTelegramChatIdPlaceholder')}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('settings.webhooksTelegramChatIdHint')}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.webhooksUrl')}</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('settings.webhooksUrlPlaceholder')}
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.webhooksSecret')}</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t('settings.webhooksSecretPlaceholder')}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">{t('settings.webhooksSecretHint')}</p>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">{t('settings.webhooksEvents')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENT_TYPES.map((event) => (
            <button
              key={event}
              type="button"
              onClick={() => toggleEvent(event)}
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors cursor-pointer',
                events.includes(event)
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
              )}
            >
              {events.includes(event) && <Check className="mr-1 size-3" />}
              {t(EVENT_LABEL_KEYS[event])}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch size="sm" checked={isActive} onCheckedChange={setIsActive} />
          <span className="text-xs text-muted-foreground">{t('settings.webhooksActive')}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('settings.webhooksCancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!url || (isTelegram && !secret) || events.length === 0 || isPending}
          >
            {isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {isPending
              ? isEditing
                ? t('settings.webhooksUpdating')
                : t('settings.webhooksCreating')
              : t('settings.webhooksSave')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function WebhookCard({
  webhook,
  isExpanded,
  onToggleExpand,
  onEdit,
}: {
  webhook: Webhook
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const deleteWebhook = useDeleteWebhook()
  const updateWebhook = useUpdateWebhook()
  const testWebhook = useTestWebhook()

  const handleToggleActive = (checked: boolean) => {
    updateWebhook.mutate({ id: webhook.id, isActive: checked })
  }

  const handleDelete = () => {
    if (window.confirm(t('settings.webhooksDeleteConfirm'))) {
      deleteWebhook.mutate(webhook.id)
    }
  }

  const isTelegram = webhook.channel === 'telegram'

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="min-w-0 flex-1 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2">
            {isTelegram ? (
              <BotMessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Globe className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-sm font-mono">
              {isTelegram ? `Telegram (${webhook.url})` : webhook.url}
            </span>
            {!webhook.isActive && (
              <Badge variant="secondary" className="text-[10px]">
                {t('settings.webhooksDisabled')}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex gap-1 pl-5.5">
            {webhook.events.map((event) => (
              <span key={event} className="text-[10px] text-muted-foreground">
                {t(EVENT_LABEL_KEYS[event])}
                {event !== webhook.events[webhook.events.length - 1] && ','}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Switch size="sm" checked={webhook.isActive} onCheckedChange={handleToggleActive} />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => testWebhook.mutate(webhook.id)}
            disabled={testWebhook.isPending}
            title={t('settings.webhooksTest')}
          >
            {testWebhook.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteWebhook.isPending}
          >
            {deleteWebhook.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {isExpanded && <DeliveryList webhookId={webhook.id} />}
    </div>
  )
}

function DeliveryList({ webhookId }: { webhookId: string }) {
  const { t } = useTranslation()
  const { data: deliveries, isLoading } = useWebhookDeliveries(webhookId, true)

  if (isLoading) {
    return (
      <div className="border-t px-3 py-4 flex justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="border-t px-3 py-3 text-center text-xs text-muted-foreground">
        {t('settings.webhooksDeliveriesEmpty')}
      </div>
    )
  }

  return (
    <div className="border-t">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {t('settings.webhooksDeliveries')}
      </div>
      <div className="max-h-48 overflow-y-auto">
        {deliveries.map((d) => (
          <div key={d.id} className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
            {d.success ? (
              <CircleCheck className="size-3.5 shrink-0 text-green-500" />
            ) : (
              <CircleAlert className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="text-muted-foreground">{d.event}</span>
            <span className="text-muted-foreground">{d.statusCode ?? '—'}</span>
            {d.duration != null && <span className="text-muted-foreground">{d.duration}ms</span>}
            <span className="ml-auto text-muted-foreground">
              {new Date(d.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
