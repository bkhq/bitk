import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { FileEdit, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MultiFileDiff } from '@pierre/diffs/react'
import { useTheme } from '@/hooks/use-theme'
import { codeToHtml } from '@/lib/shiki'
import type { NormalizedLogEntry } from '@/types/kanban'
import { getCommandPreview } from '@/lib/command-preview'
import { LogEntry } from './LogEntry'

/** Extract duration (ms) from the last system-message with duration metadata in a turn */
function getTurnDuration(
  logs: NormalizedLogEntry[],
  turn: number,
): number | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs.at(i)
    if (!entry) continue
    if ((entry.turnIndex ?? 0) !== turn) continue
    if (
      entry.entryType === 'system-message' &&
      entry.metadata &&
      typeof entry.metadata.duration === 'number'
    ) {
      return entry.metadata.duration
    }
  }
  return null
}

/**
 * For each turn, find the index of the last assistant-message so we can
 * attach the turn's duration to it.
 */
function buildDurationMap(logs: NormalizedLogEntry[]): Map<number, number> {
  // turnNumber → last assistant-message index
  const lastAssistantIdx = new Map<number, number>()
  for (let i = 0; i < logs.length; i++) {
    const entry = logs.at(i)
    if (entry?.entryType === 'assistant-message') {
      lastAssistantIdx.set(entry.turnIndex ?? 0, i)
    }
  }

  // logIndex → durationMs
  const durationMap = new Map<number, number>()
  for (const [turn, idx] of lastAssistantIdx) {
    const dur = getTurnDuration(logs, turn)
    if (dur !== null) {
      durationMap.set(idx, dur)
    }
  }
  return durationMap
}

function stringifyPretty(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

interface ParsedFileToolInput {
  filePath?: string
  content?: string
  oldString?: string
  newString?: string
  hasOnlyFilePath: boolean
  raw: string
}

function parseFileToolInput(input: unknown): ParsedFileToolInput {
  const raw = stringifyPretty(input)
  if (!input || typeof input !== 'object') {
    return { hasOnlyFilePath: false, raw }
  }
  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj)
  const hasOnlyFilePath = keys.length === 1 && keys[0] === 'file_path'
  return {
    filePath: typeof obj.file_path === 'string' ? obj.file_path : undefined,
    content: typeof obj.content === 'string' ? obj.content : undefined,
    oldString: typeof obj.old_string === 'string' ? obj.old_string : undefined,
    newString: typeof obj.new_string === 'string' ? obj.new_string : undefined,
    hasOnlyFilePath,
    raw,
  }
}

function detectCodeLanguage(filePath?: string): string {
  if (!filePath) return 'text'
  const p = filePath.toLowerCase()
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.tsx')) return 'tsx'
  if (p.endsWith('.js')) return 'javascript'
  if (p.endsWith('.jsx')) return 'jsx'
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'markdown'
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html'
  if (p.endsWith('.css')) return 'css'
  if (p.endsWith('.py')) return 'python'
  if (p.endsWith('.sql')) return 'sql'
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml'
  if (p.endsWith('.xml')) return 'xml'
  if (p.endsWith('.go')) return 'go'
  if (p.endsWith('.rs')) return 'rust'
  if (p.endsWith('.sh') || p.endsWith('.bash') || p.endsWith('.zsh'))
    return 'shell'
  if (p.endsWith('.toml')) return 'toml'
  if (p.endsWith('.dockerfile') || p.includes('Dockerfile')) return 'dockerfile'
  return 'text'
}

function ShikiCodeBlock({
  content,
  language = 'text',
  maxHeightClass,
}: {
  content: string
  language?: string
  maxHeightClass: string
}) {
  const [html, setHtml] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    codeToHtml(content, language).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [content, language])

  if (!html) {
    return (
      <pre
        className={`code-surface ${maxHeightClass} overflow-auto rounded-md p-2 text-[12px] leading-[1.45] font-mono`}
      >
        {content}
      </pre>
    )
  }

  return (
    <div
      className={`code-surface shiki-block ${maxHeightClass} overflow-auto rounded-md`}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}

function CodeBlock({
  content,
  language = 'text',
  collapsible = false,
}: {
  content: string
  language?: string
  collapsible?: boolean
}) {
  const value = content || '(empty)'
  const maxHeightClass = collapsible ? 'max-h-64' : 'max-h-80'
  return (
    <ShikiCodeBlock
      content={value}
      language={language}
      maxHeightClass={maxHeightClass}
    />
  )
}

function ShikiUnifiedDiff({
  original,
  modified,
  filePath,
}: {
  original: string
  modified: string
  filePath?: string
}) {
  const { resolved } = useTheme()
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const name = filePath ?? 'file'

  return (
    <div className="overflow-x-auto rounded-md border border-border/40">
      <MultiFileDiff
        oldFile={{ name, contents: original }}
        newFile={{ name, contents: modified }}
        options={{
          diffStyle: 'unified',
          diffIndicators: 'bars',
          expandUnchanged: false,
          hunkSeparators: 'line-info',
          disableLineNumbers: false,
          overflow: 'wrap',
          theme: {
            light: 'github-light-default',
            dark: 'github-dark-default',
          },
          themeType,
          disableFileHeader: true,
        }}
      />
    </div>
  )
}

function ToolPanel({
  summary,
  children,
  collapsible = false,
}: {
  summary: React.ReactNode
  children: React.ReactNode
  collapsible?: boolean
}) {
  if (collapsible) {
    return (
      <details className="group/panel rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
        <summary className="cursor-pointer list-none px-2.5 py-1.5 transition-colors hover:bg-muted/20">
          {summary}
        </summary>
        <div className="px-2.5 pb-2.5 pt-1.5 border-t border-border/20">
          {children}
        </div>
      </details>
    )
  }
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10">
      <div className="px-2.5 py-1.5">{summary}</div>
      <div className="px-2.5 pb-2.5 pt-1.5 border-t border-border/20">
        {children}
      </div>
    </div>
  )
}

function FileToolGroup({
  actionEntry,
  resultEntry,
}: {
  actionEntry: NormalizedLogEntry
  resultEntry: NormalizedLogEntry
}) {
  const tool = actionEntry.toolAction
  const isEdit = tool?.kind === 'file-edit'
  const toolName =
    typeof actionEntry.metadata?.toolName === 'string'
      ? actionEntry.metadata.toolName
      : undefined
  const isWrite = toolName === 'Write'
  const filePath = tool && 'path' in tool ? tool.path : 'unknown'
  const codeLanguage = detectCodeLanguage(filePath)
  const parsed = parseFileToolInput(actionEntry.metadata?.input)
  const hasContent = parsed.content !== undefined
  const hasOldString = parsed.oldString !== undefined
  const hasNewString = parsed.newString !== undefined

  // File-read: show only the file path, no content
  if (!isEdit) {
    return (
      <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0 text-blue-500" />
        <span className="font-mono truncate">File Read: {filePath}</span>
      </div>
    )
  }

  return (
    <ToolPanel
      collapsible
      summary={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileEdit className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="font-mono truncate">
            {isWrite ? 'File Write' : 'File Edit'}: {filePath}
          </span>
        </div>
      }
    >
      <div className="space-y-2">
        {hasContent ? (
          <CodeBlock
            content={parsed.content!}
            language={codeLanguage}
            collapsible={false}
          />
        ) : null}

        {hasOldString ? (
          hasNewString ? (
            <ShikiUnifiedDiff
              original={parsed.oldString || ''}
              modified={parsed.newString || ''}
              filePath={filePath}
            />
          ) : (
            <CodeBlock
              content={parsed.oldString || ''}
              language={codeLanguage}
              collapsible={false}
            />
          )
        ) : null}

        {!hasOldString && hasNewString ? (
          <CodeBlock
            content={parsed.newString || ''}
            language={codeLanguage}
            collapsible={false}
          />
        ) : null}

        {!hasContent &&
        !hasOldString &&
        !hasNewString &&
        !parsed.hasOnlyFilePath ? (
          <CodeBlock
            content={parsed.raw || '(empty)'}
            language="json"
            collapsible={false}
          />
        ) : null}
      </div>
    </ToolPanel>
  )
}

export function SessionMessages({
  logs,
  scrollRef,
  isRunning = false,
  workingStep,
  onCancel,
  isCancelling = false,
  devMode = false,
}: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  devMode?: boolean
}) {
  const { t } = useTranslation()

  const todoCallIds = new Set(
    logs
      .filter((entry) => {
        if (entry.entryType !== 'tool-use') return false
        const md = entry.metadata
        return md?.toolName === 'TodoWrite' && typeof md.toolCallId === 'string'
      })
      .map((entry) => String(entry.metadata?.toolCallId)),
  )

  // Backend filters entries by devMode (default: only user + assistant messages).
  // Frontend only hides TodoWrite tool calls which are always noise.
  const visibleLogs = logs.filter((entry) => {
    if (entry.entryType !== 'tool-use') return true
    const md = entry.metadata
    if (md?.toolName === 'TodoWrite') return false
    if (
      md?.isResult === true &&
      typeof md.toolCallId === 'string' &&
      todoCallIds.has(md.toolCallId)
    ) {
      return false
    }
    return true
  })

  // Auto-scroll to bottom on new logs
  const prevLenRef = useRef(visibleLogs.length)
  useEffect(() => {
    if (visibleLogs.length !== prevLenRef.current || isRunning) {
      scrollRef?.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
    prevLenRef.current = visibleLogs.length
  }, [visibleLogs.length, isRunning, scrollRef])

  if (visibleLogs.length === 0 && !isRunning) return null

  const durationMap = buildDurationMap(visibleLogs)

  // Build a map from toolCallId → index for all tool-result entries,
  // so tool-call entries can find their matching result regardless of position.
  // Iterate in reverse so the first result per callId wins (Map.set overwrites).
  const resultByCallId = new Map<string, number>()
  for (let i = visibleLogs.length - 1; i >= 0; i--) {
    const e = visibleLogs[i]
    if (
      e.entryType === 'tool-use' &&
      e.metadata?.isResult === true &&
      typeof e.metadata.toolCallId === 'string'
    ) {
      resultByCallId.set(e.metadata.toolCallId, i)
    }
  }

  // Track which result indices have been consumed by a tool-call pairing
  const consumedResults = new Set<number>()
  const rows: React.ReactNode[] = []

  for (let i = 0; i < visibleLogs.length; i++) {
    const entry = visibleLogs[i]

    // Skip result entries that were already rendered as part of a tool-call group
    if (consumedResults.has(i)) continue

    const callId = entry.metadata?.toolCallId
    const isToolCall =
      entry.entryType === 'tool-use' && entry.metadata?.isResult !== true

    // Find matching result by toolCallId (not just consecutive position)
    let matchedResult: NormalizedLogEntry | null = null
    let matchedResultIdx = -1
    if (isToolCall && typeof callId === 'string') {
      const rIdx = resultByCallId.get(callId)
      if (rIdx !== undefined) {
        matchedResult = visibleLogs[rIdx]
        matchedResultIdx = rIdx
      }
    }

    if (isToolCall && matchedResult) {
      consumedResults.add(matchedResultIdx)
      const actionKind = entry.toolAction?.kind
      if (actionKind === 'file-edit' || actionKind === 'file-read') {
        rows.push(
          <div
            key={`file-tool-group-${entry.messageId ?? `${entry.turnIndex ?? 0}-${i}`}`}
            className="px-5 py-0.5 animate-message-enter"
          >
            <FileToolGroup actionEntry={entry} resultEntry={matchedResult} />
          </div>,
        )
        continue
      }

      if (actionKind === 'command-run') {
        const fullCommand =
          entry.toolAction?.kind === 'command-run'
            ? entry.toolAction.command
            : ''
        const isTruncatedInTitle = getCommandPreview(
          fullCommand,
          90,
        ).isTruncated
        const showFullCommand = isTruncatedInTitle || fullCommand.includes('\n')
        rows.push(
          <div
            key={`tool-group-${entry.messageId ?? `${entry.turnIndex ?? 0}-${i}`}`}
            className="px-5 py-0.5 animate-message-enter"
          >
            <ToolPanel
              collapsible
              summary={<LogEntry entry={entry} inToolGroup />}
            >
              <div className="space-y-2">
                {showFullCommand ? (
                  <div className="rounded-md border border-border/30 bg-muted/10 p-2 space-y-1">
                    <div className="px-0.5 text-[11px] text-muted-foreground">
                      {t('session.tool.fullCommand')}
                    </div>
                    <CodeBlock
                      content={fullCommand}
                      language="shell"
                      collapsible={false}
                    />
                  </div>
                ) : null}
                <CodeBlock
                  content={matchedResult.content || '(empty)'}
                  collapsible={false}
                />
              </div>
            </ToolPanel>
          </div>,
        )
        continue
      }

      rows.push(
        <div
          key={`tool-group-${entry.messageId ?? `${entry.turnIndex ?? 0}-${i}`}`}
          className="px-5 py-0.5 animate-message-enter"
        >
          <ToolPanel
            collapsible
            summary={<LogEntry entry={entry} inToolGroup />}
          >
            <CodeBlock
              content={matchedResult.content || '(empty)'}
              collapsible={false}
            />
          </ToolPanel>
        </div>,
      )
      continue
    }

    rows.push(
      <LogEntry
        key={
          entry.messageId ?? `${entry.turnIndex ?? 0}-${i}-${entry.entryType}`
        }
        entry={entry}
        durationMs={durationMap.get(i)}
      />,
    )
  }

  return (
    <div className="flex flex-col py-2">
      {rows}
      {isRunning ? (
        <div className="flex items-center gap-2.5 mx-5 my-2 px-3 py-2 text-xs text-muted-foreground animate-message-enter">
          <span className="thinking-dots flex items-center gap-[3px] text-violet-500/70 dark:text-violet-400/70">
            <span />
            <span />
            <span />
          </span>
          <span className="font-medium text-violet-500/70 dark:text-violet-400/70">
            {t('session.thinking')}
          </span>
          {workingStep ? (
            <span className="truncate text-[11px] text-muted-foreground/60 italic">
              {workingStep}
            </span>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="ml-auto rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
