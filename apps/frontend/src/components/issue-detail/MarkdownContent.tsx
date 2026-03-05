import type { Components } from 'react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ShikiCodeBlock } from '../files/ShikiCodeBlock'

const HEADING_PREFIX: Record<string, string> = {
  h1: '#',
  h2: '##',
  h3: '###',
  h4: '####',
  h5: '#####',
  h6: '######',
}

/** Render headings as plain bold text with original markdown prefix. */
function FlatHeading({
  node,
  children,
}: {
  node?: { tagName?: string }
  children?: React.ReactNode
}) {
  const prefix = HEADING_PREFIX[node?.tagName ?? ''] ?? '#'
  return (
    <p className="font-semibold my-1">
      {prefix} {children}
    </p>
  )
}

/** Render links as plain text — no clickable <a> tags. */
function PlainLink({ children, href }: { children?: React.ReactNode; href?: string }) {
  if (href) {
    return <span>{children} ({href})</span>
  }
  return <span>{children}</span>
}

const components: Components = {
  h1: FlatHeading as Components['h1'],
  h2: FlatHeading as Components['h2'],
  h3: FlatHeading as Components['h3'],
  h4: FlatHeading as Components['h4'],
  h5: FlatHeading as Components['h5'],
  h6: FlatHeading as Components['h6'],
  a: PlainLink as Components['a'],
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const text = String(children ?? '')
    const isBlock = className || text.includes('\n')

    if (isBlock) {
      const code = text.replace(/\n$/, '')
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
}

export function MarkdownContent({
  content,
  className: containerClassName = '',
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-0 prose-pre:m-0 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-table:text-xs prose-th:text-left prose-th:font-medium prose-td:align-top ${containerClassName}`}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
