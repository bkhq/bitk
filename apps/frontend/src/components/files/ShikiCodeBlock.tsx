import { useEffect, useState } from 'react'
import { codeToHtml } from '@/lib/shiki'

interface ShikiCodeBlockProps {
  code: string
  lang: string
}

export function ShikiCodeBlock({ code, lang }: ShikiCodeBlockProps) {
  const [html, setHtml] = useState<string>('')

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
      className="[&_.shiki]:rounded-md [&_.shiki]:p-4 [&_.shiki]:text-sm [&_.shiki]:overflow-x-auto [&_code]:leading-relaxed"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki generates safe HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
