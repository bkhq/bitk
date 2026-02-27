import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'

import type { HighlighterCore } from 'shiki'

let highlighter: HighlighterCore | null = null
let highlighterLoading: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter
  if (!highlighterLoading) {
    highlighterLoading = (async () => {
      const { createHighlighter } = await import('shiki')
      const hl = await createHighlighter({
        themes: ['github-light-default', 'github-dark-default'],
        langs: ['markdown'],
      })
      highlighter = hl
      return hl
    })()
  }
  return highlighterLoading
}

export function MarkdownContent({
  content,
  className: containerClassName = '',
}: {
  content: string
  className?: string
}) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    let cancelled = false
    getHighlighter().then((hl) => {
      if (cancelled) return
      const result = hl.codeToHtml(content, {
        lang: 'markdown',
        themes: {
          light: 'github-light-default',
          dark: 'github-dark-default',
        },
        defaultColor: false,
      })
      setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [content])

  if (!html) {
    return (
      <div className={`markdown-shiki ${containerClassName}`}>
        <pre className="whitespace-pre-wrap break-words">{content}</pre>
      </div>
    )
  }

  return (
    <div
      className={`markdown-shiki ${containerClassName}`}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}
