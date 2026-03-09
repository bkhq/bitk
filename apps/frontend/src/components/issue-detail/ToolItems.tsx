import type { ToolGroupChatMessage, ToolGroupItem } from '@bkd/shared'
import { useTranslation } from 'react-i18next'
import { getCommandPreview } from '@/lib/command-preview'
import { formatFileSize } from '@/lib/format'
import {
  CodeBlock,
  detectCodeLanguage,
  parseFileToolInput,
  ShikiUnifiedDiff,
  ToolPanel,
} from './CodeRenderers'

function getItemToolName(item: ToolGroupItem): string | undefined {
  return (
    item.action.toolDetail?.toolName ??
    (typeof item.action.metadata?.toolName === 'string' ? item.action.metadata.toolName : undefined)
  )
}

function countLines(text: string | undefined | null): number | null {
  if (!text) return null
  return text.split('\n').length
}

/** Compute +added / -removed line counts from old/new strings. */
function diffStats(
  oldStr: string | undefined,
  newStr: string | undefined,
): { added: number, removed: number } | null {
  if (oldStr === undefined && newStr === undefined) return null
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

/** Badge component for file path */
function PathBadge({ path }: { path: string }) {
  return (
    <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">{path}</code>
  )
}

/** Diff stats display: +N -M */
function DiffStatsLabel({ added, removed }: { added: number, removed: number }) {
  return (
    <span className="flex items-center gap-1 text-[11px] shrink-0">
      {added > 0 ?
          (
            <span className="text-emerald-600 dark:text-emerald-400">
              +
              {added}
            </span>
          ) :
        null}
      {removed > 0 ?
          (
            <span className="text-red-600 dark:text-red-400">
              -
              {removed}
            </span>
          ) :
        null}
    </span>
  )
}

// ── Single tool item renderers ───────────────────────────

export function FileToolItem({ item }: { item: ToolGroupItem }) {
  const actionEntry = item.action
  const tool = actionEntry.toolAction
  const isEdit = tool?.kind === 'file-edit'
  const toolName =
    typeof actionEntry.metadata?.toolName === 'string' ? actionEntry.metadata.toolName : undefined
  const isWrite = toolName === 'Write'
  const filePath = tool && 'path' in tool ? tool.path : 'unknown'
  const codeLanguage = detectCodeLanguage(filePath)
  const parsed = parseFileToolInput(actionEntry.metadata?.input)
  const hasContent = parsed.content !== undefined
  const hasOldString = parsed.oldString !== undefined
  const hasNewString = parsed.newString !== undefined

  if (!isEdit) {
    const resultContent = item.result?.content
    const isResultError =
      item.result?.toolDetail?.raw?.isError === true || item.result?.entryType === 'error-message'
    const lineCount = countLines(resultContent)
    const showResultText = resultContent && isResultError

    const summary = (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Read</span>
        <PathBadge path={filePath} />
      </div>
    )

    if (showResultText) {
      return (
        <ToolPanel collapsible summary={summary}>
          <div
            className={`text-[11px] font-mono whitespace-pre-wrap ${isResultError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/60'}`}
          >
            {resultContent}
          </div>
        </ToolPanel>
      )
    }

    const sizeInfo = lineCount ?
      `Read ${lineCount} lines` :
      resultContent ?
        `${formatFileSize(resultContent.length)}` :
        null

    return (
      <div className="py-0.5">
        {summary}
        {sizeInfo ?
            (
              <div className="ml-0.5 mt-0.5 text-[11px] text-muted-foreground/60">{sizeInfo}</div>
            ) :
          null}
      </div>
    )
  }

  // File edit / write
  const stats = diffStats(parsed.oldString, parsed.newString ?? parsed.content)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">{isWrite ? 'Write' : 'Edit'}</span>
          <PathBadge path={filePath} />
          {stats ? <DiffStatsLabel added={stats.added} removed={stats.removed} /> : null}
        </div>
      )}
    >
      <div className="space-y-2">
        {hasContent ?
            (
              <CodeBlock content={parsed.content!} language={codeLanguage} collapsible={false} />
            ) :
          null}

        {hasOldString ?
            (
              hasNewString ?
                  (
                    <ShikiUnifiedDiff
                      original={parsed.oldString || ''}
                      modified={parsed.newString || ''}
                      filePath={filePath}
                    />
                  ) :
                  (
                    <CodeBlock
                      content={parsed.oldString || ''}
                      language={codeLanguage}
                      collapsible={false}
                    />
                  )
            ) :
          null}

        {!hasOldString && hasNewString ?
            (
              <CodeBlock content={parsed.newString || ''} language={codeLanguage} collapsible={false} />
            ) :
          null}

        {!hasContent && !hasOldString && !hasNewString && !parsed.hasOnlyFilePath ?
            (
              <CodeBlock content={parsed.raw || '(empty)'} language="json" collapsible={false} />
            ) :
          null}
      </div>
    </ToolPanel>
  )
}

export function CommandToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const fullCommand =
    item.action.toolAction?.kind === 'command-run' ? item.action.toolAction.command : ''
  const preview = getCommandPreview(fullCommand, 80)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Bash</span>
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {preview.summary}
          </code>
        </div>
      )}
    >
      <div className="space-y-2">
        {preview.isTruncated || fullCommand.includes('\n') ?
            (
              <div className="rounded-md border border-border/30 bg-muted/10 p-2 space-y-1">
                <div className="px-0.5 text-[11px] text-muted-foreground">
                  {t('session.tool.fullCommand')}
                </div>
                <CodeBlock content={fullCommand} language="shell" collapsible={false} />
              </div>
            ) :
          null}
        <CodeBlock
          content={item.result?.content || item.action.content || '(empty)'}
          collapsible={false}
        />
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
  const isResultError =
    item.result?.toolDetail?.raw?.isError === true || item.result?.entryType === 'error-message'

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Agent</span>
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {description}
          </code>
        </div>
      )}
    >
      {resultContent ?
          (
            <pre
              className={`text-[11px] whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto ${isResultError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/70'}`}
            >
              {resultContent}
            </pre>
          ) :
        null}
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
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">{toolName || 'Search'}</span>
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
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">{toolName || 'Tool'}</span>
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
    <div className="py-0.5 animate-message-enter">
      <div className="rounded-lg border border-border/30 bg-card/50">
        {/* Header */}
        <div className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="truncate">{description || statsLabel}</span>
          {description ?
              (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                  {statsLabel}
                </span>
              ) :
            null}
        </div>

        {/* Tree items */}
        <div className="mx-3 mb-2 border-l border-border/40 pl-4 space-y-1">
          {items.map((item, idx) => (
            <ToolItemRenderer key={item.action.messageId ?? `ti-${idx}`} item={item} idx={idx} />
          ))}
        </div>
      </div>
    </div>
  )
}
