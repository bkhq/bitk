import DOMPurify from 'dompurify'
import { useEffect, useMemo, useState } from 'react'
import { codeToHtml } from '@/lib/shiki'

/** Calculate display width accounting for CJK characters (width 2). */
function displayWidth(str: string): number {
  let w = 0
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0
    // CJK Unified Ideographs, CJK Compatibility, Fullwidth forms, etc.
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

/** Pad string with spaces to reach target display width. */
function padEnd(str: string, targetWidth: number): string {
  const diff = targetWidth - displayWidth(str)
  return diff > 0 ? str + ' '.repeat(diff) : str
}

/** Reformat a markdown table block with space-padded columns. */
function formatTable(block: string): string {
  const lines = block.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return block

  const parseCells = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

  const isSep = (line: string) =>
    /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?$/.test(line.trim())

  if (!isSep(lines[1])) return block

  const allCells = lines.filter((l) => !isSep(l)).map(parseCells)
  const colCount = Math.max(...allCells.map((r) => r.length))

  // Calculate max display width per column
  const colWidths: number[] = Array(colCount).fill(0)
  for (const row of allCells) {
    for (let i = 0; i < colCount; i++) {
      const w = displayWidth(row[i] ?? '')
      if (w > colWidths[i]) colWidths[i] = w
    }
  }

  const formatRow = (cells: string[]) => {
    const padded = Array.from({ length: colCount }, (_, i) =>
      padEnd(cells[i] ?? '', colWidths[i]),
    )
    return `| ${padded.join(' | ')} |`
  }

  const sepLine = `| ${colWidths.map((w) => '-'.repeat(w)).join(' | ')} |`

  const header = parseCells(lines[0])
  const dataRows = lines.slice(2).filter((l) => !isSep(l)).map(parseCells)

  return [formatRow(header), sepLine, ...dataRows.map(formatRow)].join('\n')
}

/** Pre-process content: format tables with space padding for monospace alignment. */
function preprocessContent(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let tableBuf: string[] = []

  const flushTable = () => {
    if (tableBuf.length > 0) {
      result.push(formatTable(tableBuf.join('\n')))
      tableBuf = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const isTableLine =
      trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1
    if (isTableLine) {
      tableBuf.push(line)
    } else {
      flushTable()
      result.push(line)
    }
  }
  flushTable()
  return result.join('\n')
}

export function MarkdownContent({
  content,
  className: containerClassName = '',
}: {
  content: string
  className?: string
}) {
  const formatted = useMemo(() => preprocessContent(content), [content])
  const [html, setHtml] = useState('')

  useEffect(() => {
    setHtml('')
    let cancelled = false
    void codeToHtml(formatted, 'markdown').then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [formatted])

  if (!html) {
    return (
      <div className={`markdown-shiki ${containerClassName}`}>
        <pre className="whitespace-pre-wrap break-words">{formatted}</pre>
      </div>
    )
  }

  return (
    <div
      className={`markdown-shiki ${containerClassName}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized via DOMPurify.sanitize()
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}
