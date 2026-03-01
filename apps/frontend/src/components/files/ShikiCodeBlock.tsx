import { useEffect, useState } from 'react'
import { codeToHtml } from '@/lib/shiki'

interface ShikiCodeBlockProps {
  code: string
  lang: string
}

export function ShikiCodeBlock({ code, lang }: ShikiCodeBlockProps) {
  const [html, setHtml] = useState<string>('')

  useEffect(() => {
    setHtml('')
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
      <pre className="overflow-x-auto rounded-md bg-popover p-3 text-xs font-mono leading-snug">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="rounded-md bg-popover overflow-hidden [&_.shiki]:!bg-transparent [&_.shiki]:p-3 [&_.shiki]:text-xs [&_.shiki]:overflow-x-auto [&_code]:leading-snug"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki generates safe HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
