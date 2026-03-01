import { useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ShikiCodeBlock } from './ShikiCodeBlock'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const renderPre = useCallback(
    ({ children }: React.HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    [],
  )

  const renderCode = useCallback(
    ({
      className,
      children,
      ...rest
    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
      const isBlock = typeof children === 'string' && children.includes('\n')

      if (isBlock || className) {
        const code = String(children).replace(/\n$/, '')
        const lang = className?.replace('language-', '') ?? 'text'
        return <ShikiCodeBlock code={code} lang={lang} />
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
    <div className="prose prose-sm dark:prose-invert max-w-none px-6 py-5 prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:underline-offset-2 prose-pre:p-0 prose-pre:m-0 prose-img:rounded-md prose-table:text-sm prose-th:text-left prose-th:font-medium prose-td:align-top">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: renderPre,
          code: renderCode,
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
