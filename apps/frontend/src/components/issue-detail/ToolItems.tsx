import type { ToolGroupChatMessage, ToolGroupItem } from '@bkd/shared'
import {
  Check,
  ChevronRight,
  Copy,
  FileEdit,
  FileText,
  Search,
  Terminal,
  Users,
  Wrench,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCommandPreview } from '@/lib/command-preview'
import {
  CodeBlock,
  detectCodeLanguage,
  parseFileToolInput,
  ShikiPatchDiff,
  ShikiUnifiedDiff,
  ToolPanel,
} from './CodeRenderers'
import { MarkdownContent } from './MarkdownContent'

function getItemToolName(item: ToolGroupItem): string | undefined {
  return (
    item.action.toolDetail?.toolName
    ?? (typeof item.action.metadata?.toolName === 'string' ? item.action.metadata.toolName : undefined)
  )
}

/** Compute +added / -removed line counts from old/new strings or patch. */
function diffStats(
  oldStr: string | undefined,
  newStr: string | undefined,
  patch?: string | undefined,
): { added: number, removed: number } | null {
  if (oldStr === undefined && newStr === undefined && patch === undefined) return null
  // Parse unified diff patch for line counts
  if (patch !== undefined && oldStr === undefined && newStr === undefined) {
    let added = 0
    let removed = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      else if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
    return (added > 0 || removed > 0) ? { added, removed } : null
  }
  const oldLines = oldStr ? oldStr.split('\n').length : 0
  const newLines = newStr ? newStr.split('\n').length : 0
  if (oldStr !== undefined && newStr !== undefined) {
    // Edit with both old and new — approximate diff
    return { added: newLines, removed: oldLines }
  }
  // Write (content only) — all additions
  if (newStr !== undefined) return { added: newLines, removed: 0 }
  return null
}

// ── Shared components ────────────────────────────────────

/** Check if an item result is an error */
function isItemError(item: ToolGroupItem): boolean {
  return item.result?.toolDetail?.raw?.isError === true
    || item.result?.entryType === 'error-message'
}

/** Tool type icon + label */
function ToolLabel({ label, icon: Icon }: { label: string, icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="flex items-center gap-1 shrink-0 text-[11px] text-muted-foreground/70">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

/** Badge component for file path */
function PathBadge({ path }: { path: string }) {
  return (
    <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono overflow-x-auto whitespace-nowrap scrollbar-none">{path}</code>
  )
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [path])
  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}

/** Diff stats display: +N -M */
function DiffStatsLabel({ added, removed }: { added: number, removed: number }) {
  return (
    <span className="flex items-center gap-1 text-[11px] shrink-0">
      {added > 0
        ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              +
              {added}
            </span>
          )
        : null}
      {removed > 0
        ? (
            <span className="text-red-600 dark:text-red-400">
              -
              {removed}
            </span>
          )
        : null}
    </span>
  )
}

/** Extract Bash tool description from input metadata */
function getCommandDescription(item: ToolGroupItem): string | undefined {
  const input = item.action.metadata?.input
  if (input && typeof input === 'object' && 'description' in input) {
    const desc = (input as Record<string, unknown>).description
    return typeof desc === 'string' ? desc : undefined
  }
  return undefined
}

// ── Single tool item renderers ───────────────────────────

export function FileToolItem({ item }: { item: ToolGroupItem }) {
  const actionEntry = item.action
  const tool = actionEntry.toolAction
  const isEdit = tool?.kind === 'file-edit'
  const toolName
    = typeof actionEntry.metadata?.toolName === 'string' ? actionEntry.metadata.toolName : undefined
  const isWrite = toolName === 'Write'
  const filePath = tool && 'path' in tool ? tool.path : 'unknown'
  const codeLanguage = detectCodeLanguage(filePath)
  const parsed = parseFileToolInput(actionEntry.metadata?.input)
  const hasContent = parsed.content !== undefined
  const hasOldString = parsed.oldString !== undefined
  const hasNewString = parsed.newString !== undefined
  const hasPatch = parsed.patch !== undefined
  const hasUnifiedDiff = parsed.unifiedDiff !== undefined

  if (!isEdit) {
    const resultContent = item.result?.content
    const hasError = isItemError(item)
    const showResultText = resultContent && hasError

    return (
      <ToolPanel
        summary={(
          <div className="flex items-center gap-2 min-w-0">
            <ToolLabel label="Read" icon={FileText} />
            <PathBadge path={filePath} />
          </div>
        )}
        actions={<CopyPathButton path={filePath} />}
      >
        {showResultText
          ? (
              <div className="text-[11px] font-mono whitespace-pre-wrap text-red-600 dark:text-red-400">
                {resultContent}
              </div>
            )
          : null}
      </ToolPanel>
    )
  }

  // File edit / write
  const stats = diffStats(parsed.oldString, parsed.newString ?? parsed.content, parsed.patch)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={isWrite ? 'Write' : 'Edit'} icon={FileEdit} />
          <PathBadge path={filePath} />
          {stats ? <DiffStatsLabel added={stats.added} removed={stats.removed} /> : null}
        </div>
      )}
    >
      <div className="space-y-2">
        {hasContent
          ? <CodeBlock content={parsed.content!} language={codeLanguage} collapsible={false} />
          : null}

        {hasOldString
          ? (
              hasNewString
                ? (
                    <ShikiUnifiedDiff
                      original={parsed.oldString || ''}
                      modified={parsed.newString || ''}
                      filePath={filePath}
                    />
                  )
                : (
                    <CodeBlock
                      content={parsed.oldString || ''}
                      language={codeLanguage}
                      collapsible={false}
                    />
                  )
            )
          : null}

        {!hasOldString && hasNewString
          ? <CodeBlock content={parsed.newString || ''} language={codeLanguage} collapsible={false} />
          : null}

        {!hasOldString && !hasNewString && hasPatch
          ? <ShikiPatchDiff patch={parsed.patch!} />
          : null}

        {!hasPatch && hasUnifiedDiff && !hasContent && !hasOldString && !hasNewString
          ? <ShikiPatchDiff patch={parsed.unifiedDiff!} />
          : null}

        {!hasContent && !hasOldString && !hasNewString && !hasPatch && !hasUnifiedDiff && !parsed.hasOnlyFilePath
          ? <CodeBlock content={parsed.raw || '(empty)'} language="json" collapsible={false} />
          : null}
      </div>
    </ToolPanel>
  )
}

export function CommandToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const fullCommand
    = item.action.toolAction?.kind === 'command-run' ? item.action.toolAction.command : ''
  const preview = getCommandPreview(fullCommand, 80)
  const description = getCommandDescription(item)
  const hasError = isItemError(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label="Bash" icon={Terminal} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {preview.summary}
          </code>
          {description
            ? (
                <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:inline">
                  {description}
                </span>
              )
            : null}
        </div>
      )}
    >
      <div className="space-y-2">
        {preview.isTruncated || fullCommand.includes('\n')
          ? (
              <div className="rounded-md border border-border/30 bg-muted/10 p-2">
                <div className="flex items-start gap-2">
                  <pre className="flex-1 text-[12px] font-mono whitespace-pre-wrap break-all leading-[1.5]">{fullCommand}</pre>
                  <button
                    type="button"
                    className="shrink-0 p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title={t('common.copy')}
                    onClick={() => navigator.clipboard.writeText(fullCommand)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          : null}
        {(() => {
          const resultContent = item.result?.content || item.action.content || '(empty)'
          return (
            <div className="relative group/result">
              <CodeBlock
                content={resultContent}
                collapsible={false}
                language={hasError ? 'text' : undefined}
              />
              <button
                type="button"
                className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/result:opacity-100 hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-all"
                title={t('common.copy')}
                onClick={() => navigator.clipboard.writeText(resultContent)}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })()}
      </div>
    </ToolPanel>
  )
}

/** Strip internal system lines from agent result content. */
function cleanAgentResult(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      if (line.startsWith('agentId:')) return false
      if (line.includes('do not mention to user')) return false
      if (line.startsWith('The agent is working in the background')) return false
      if (line.startsWith('You will be notified automatically')) return false
      if (line.startsWith('Async agent launched successfully')) return false
      return true
    })
    .join('\n')
    .trim()
}

export function AgentToolItem({ item }: { item: ToolGroupItem }) {
  const input = item.action.metadata?.input as { description?: string, prompt?: string } | undefined
  const description = input?.description || input?.prompt || 'Agent'
  const rawContent = item.result?.content || item.action.content || ''
  const resultContent = cleanAgentResult(rawContent)
  const hasError = isItemError(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label="Agent" icon={Users} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {description}
          </code>
        </div>
      )}
    >
      {resultContent
        ? (
            <div
              className={`overflow-y-auto max-h-96 ${hasError ? 'text-red-600 dark:text-red-400' : ''}`}
            >
              <MarkdownContent content={resultContent} className="text-[12px] leading-[1.7]" />
            </div>
          )
        : null}
    </ToolPanel>
  )
}

export function SearchToolItem({ item }: { item: ToolGroupItem }) {
  const tool = item.action.toolAction
  const query = tool && 'query' in tool ? tool.query : ''
  const toolName = getItemToolName(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={toolName || 'Search'} icon={Search} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {query}
          </code>
        </div>
      )}
    >
      <CodeBlock
        content={item.result?.content || item.action.content || '(empty)'}
        collapsible={false}
      />
    </ToolPanel>
  )
}

export function GenericToolItem({ item }: { item: ToolGroupItem }) {
  const toolName = getItemToolName(item)
  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={toolName || 'Tool'} icon={Wrench} />
          <span className="text-[11px] text-muted-foreground/60 truncate">
            {item.action.content}
          </span>
        </div>
      )}
    >
      <CodeBlock
        content={item.result?.content || item.action.content || '(empty)'}
        collapsible={false}
      />
    </ToolPanel>
  )
}

// ── ToolGroupMessage — collapsible group of tool calls ───

function getGroupSummaryLabel(
  stats: Record<string, number>,
  count: number,
  t: (key: string) => string,
): string {
  const parts: string[] = []
  if (stats['file-read']) parts.push(`${stats['file-read']} ${t('session.tool.fileRead')}`)
  if (stats['file-edit']) parts.push(`${stats['file-edit']} ${t('session.tool.fileEdit')}`)
  if (stats['command-run']) parts.push(`${stats['command-run']} ${t('session.tool.commandRun')}`)
  if (stats.search) parts.push(`${stats.search} ${t('session.tool.search')}`)
  if (stats['web-fetch']) parts.push(`${stats['web-fetch']} ${t('session.tool.webFetch')}`)
  const otherCount = count - Object.values(stats).reduce((a, b) => a + b, 0) + (stats.other ?? 0)
  if (otherCount > 0) parts.push(`${otherCount} other`)
  return parts.length > 0 ? parts.join(', ') : `${count} tool calls`
}

function ToolItemRenderer({ item, idx }: { item: ToolGroupItem, idx: number }) {
  const kind = item.action.toolAction?.kind
  const toolName = getItemToolName(item)
  if (toolName === 'Agent') {
    return <AgentToolItem key={item.action.messageId ?? `ti-${idx}`} item={item} />
  }
  if (kind === 'file-edit' || kind === 'file-read') {
    return <FileToolItem key={item.action.messageId ?? `ti-${idx}`} item={item} />
  }
  if (kind === 'command-run') {
    return <CommandToolItem key={item.action.messageId ?? `ti-${idx}`} item={item} />
  }
  if (kind === 'search') {
    return <SearchToolItem key={item.action.messageId ?? `ti-${idx}`} item={item} />
  }
  return <GenericToolItem key={item.action.messageId ?? `ti-${idx}`} item={item} />
}

export function ToolGroupMessage({ message }: { message: ToolGroupChatMessage }) {
  const { t } = useTranslation()
  const { items, stats, count, description } = message
  const statsLabel = getGroupSummaryLabel(stats, count, t)

  return (
    <div className="py-1.5 animate-message-enter">
      <details open className="border border-border/60 bg-card/50 group/tg">
        <summary className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer list-none select-none bg-muted/60">
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/tg:rotate-90" />
          <span className="truncate">{description || statsLabel}</span>
          {description
            ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                  {statsLabel}
                </span>
              )
            : null}
        </summary>
        <div className="divide-y divide-border/50">
          {items.map((item, idx) => (
            <ToolItemRenderer key={item.action.messageId ?? `ti-${idx}`} item={item} idx={idx} />
          ))}
        </div>
      </details>
    </div>
  )
}
