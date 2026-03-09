import { useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import 'github-markdown-css/github-markdown.css'
import { useTheme } from '@/hooks/use-theme'
import { ShikiCodeBlock } from './ShikiCodeBlock'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const { resolved } = useTheme()

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
      const text = String(children ?? '')
      const isBlock = className || text.includes('\n')

      if (isBlock) {
        const code = text.replace(/\n$/, '')
        const lang = className?.replace('language-', '') ?? 'text'
        return <ShikiCodeBlock code={code} lang={lang} />
      }

      return (
        <code className="rounded bg-muted/70 px-1.5 py-0.5 text-[0.875em] font-mono" {...rest}>
          {children}
        </code>
      )
    },
    [],
  )

  return (
    <div className="markdown-body !bg-transparent px-6 py-5" data-theme={resolved}>
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
