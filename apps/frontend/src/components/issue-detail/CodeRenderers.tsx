import DOMPurify from 'dompurify'
import { ChevronRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/use-theme'
import { codeToHtml } from '@/lib/shiki'

const LazyMultiFileDiff = lazy(() =>
  import('@pierre/diffs/react').then(m => ({ default: m.MultiFileDiff })),
)

const LazyFileDiff = lazy(() =>
  import('@pierre/diffs/react').then(m => ({ default: m.FileDiff })),
)

const lazyParsePatchFiles = () => import('@pierre/diffs').then(m => m.parsePatchFiles)

// ── Shared helpers ───────────────────────────────────────

export function stringifyPretty(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

export interface ParsedFileToolInput {
  filePath?: string
  content?: string
  oldString?: string
  newString?: string
  patch?: string
  unifiedDiff?: string
  hasOnlyFilePath: boolean
  raw: string
}

export function parseFileToolInput(input: unknown): ParsedFileToolInput {
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
    patch: typeof obj.patch === 'string' ? obj.patch : undefined,
    unifiedDiff: typeof obj.unified_diff === 'string' ? obj.unified_diff : undefined,
    hasOnlyFilePath,
    raw,
  }
}

export function detectCodeLanguage(filePath?: string): string {
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
  if (p.endsWith('.sh') || p.endsWith('.bash') || p.endsWith('.zsh')) return 'shell'
  if (p.endsWith('.toml')) return 'toml'
  if (p.endsWith('.dockerfile') || p.includes('Dockerfile')) return 'dockerfile'
  return 'text'
}

// ── Code rendering components ────────────────────────────

export function ShikiCodeBlock({
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
    void codeToHtml(content, language).then((h) => {
      if (!cancelled) setHtml(h)
    })
    return () => {
      cancelled = true
    }
  }, [content, language])

  if (!html) {
    return (
      <pre
        className={`code-surface ${maxHeightClass} overflow-auto p-2 text-[12px] leading-[1.45] font-mono`}
      >
        {content}
      </pre>
    )
  }

  return (
    <div
      className={`code-surface shiki-block ${maxHeightClass} overflow-auto`}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}

export function CodeBlock({
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
  return <ShikiCodeBlock content={value} language={language} maxHeightClass={maxHeightClass} />
}

export function ShikiUnifiedDiff({
  original,
  modified,
  filePath,
}: {
  original: string
  modified: string
  filePath?: string
}) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const name = filePath ?? 'file'

  return (
    <div className="overflow-x-auto rounded-md border border-border/40">
      <Suspense
        fallback={
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground">{t('common.loading')}</div>
        }
      >
        <LazyMultiFileDiff
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
      </Suspense>
    </div>
  )
}

/**
 * Ensure a patch string has `--- a/...` / `+++ b/...` file headers.
 * Codex `unified_diff` sometimes only contains `@@ ... @@` hunks without headers,
 * which causes parsePatchFiles to return 0 files.
 */
function ensurePatchHeaders(patch: string, filePath?: string): string {
  // Already has file headers — `--- ` followed by non-whitespace
  if (/^---\s+\S/m.test(patch)) return patch
  // Already a git diff
  if (/^diff --git/m.test(patch)) return patch
  // Prepend minimal headers — use only the basename to keep headers short
  const name = filePath ? filePath.split('/').pop() || filePath : 'file'
  return `--- a/${name}\n+++ b/${name}\n${patch}`
}

export function ShikiPatchDiff({ patch, filePath }: { patch: string, filePath?: string }) {
  const { resolved } = useTheme()
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const [fileDiffs, setFileDiffs] = useState<import('@pierre/diffs').FileDiffMetadata[] | null>(null)
  const normalizedPatch = ensurePatchHeaders(patch, filePath)

  useEffect(() => {
    let cancelled = false
    void lazyParsePatchFiles().then((parsePatchFiles) => {
      if (cancelled) return
      try {
        const parsed = parsePatchFiles(normalizedPatch)
        const files = parsed.flatMap(p => p.files)
        if (files.length > 0) setFileDiffs(files)
      }
      catch {
        // parsing failed — stay null, fallback to code block
      }
    })
    return () => { cancelled = true }
  }, [normalizedPatch])

  if (!fileDiffs) {
    return <ShikiCodeBlock content={patch} language="diff" maxHeightClass="max-h-80" />
  }

  const options = {
    diffStyle: 'unified' as const,
    diffIndicators: 'bars' as const,
    expandUnchanged: true,
    disableLineNumbers: false,
    overflow: 'wrap' as const,
    theme: {
      light: 'github-light-default' as const,
      dark: 'github-dark-default' as const,
    },
    themeType: themeType as 'dark' | 'light',
    disableFileHeader: true,
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/40">
      <Suspense
        fallback={(
          <pre className="px-2.5 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap">
            {patch}
          </pre>
        )}
      >
        {fileDiffs.map((fd, i) => (
          <LazyFileDiff key={i} fileDiff={fd} options={options} />
        ))}
      </Suspense>
    </div>
  )
}

export function ToolPanel({
  summary,
  children,
  actions,
  collapsible = false,
}: {
  summary: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  collapsible?: boolean
}) {
  if (collapsible) {
    return (
      <details className="group/panel transition-all duration-200">
        <summary className="flex items-center cursor-pointer list-none px-3 py-1.5 transition-colors hover:bg-muted/10">
          <div className="flex-1 min-w-0">{summary}</div>
          {actions ? <div className="shrink-0 ml-1">{actions}</div> : null}
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/panel:rotate-90 ml-1" />
        </summary>
        <div className="border-t border-border">{children}</div>
      </details>
    )
  }
  return (
    <div>
      <div className="flex items-center px-3 py-1.5">
        <div className="flex-1 min-w-0">{summary}</div>
        {actions ? <div className="shrink-0 ml-1">{actions}</div> : null}
      </div>
      {children ? <div className="border-t border-border">{children}</div> : null}
    </div>
  )
}
