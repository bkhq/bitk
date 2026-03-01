import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { codeToHtml } from '@/lib/shiki'

function CodeBlock({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  const [html, setHtml] = useState<string>('')
  const code = String(children).replace(/\n$/, '')
  const lang = className?.replace('language-', '') ?? 'text'

  useEffect(() => {
    let cancelled = false
    void codeToHtml(code, lang).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 text-sm">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="shiki-wrapper [&_pre]:!rounded-md [&_pre]:!p-4 [&_pre]:text-sm [&_pre]:overflow-x-auto [&_code]:leading-relaxed"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki generates safe HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const renderCode = useCallback(
    ({
      className,
      children,
      ...rest
    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
      const isBlock = typeof children === 'string' && children.includes('\n')

      if (isBlock || className) {
        return <CodeBlock className={className}>{children}</CodeBlock>
      }

      return (
        <code
          className="rounded bg-muted/70 px-1.5 py-0.5 text-[0.875em] font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    },
    [],
  )

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none px-6 py-5 prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:underline-offset-2 prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0 prose-img:rounded-md prose-table:text-sm prose-th:text-left prose-th:font-medium prose-td:align-top">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: renderCode,
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
