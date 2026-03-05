import type { Components } from 'react-markdown'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import 'github-markdown-css/github-markdown.css'
import { useTheme } from '@/hooks/use-theme'
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
  const { resolved } = useTheme()

  return (
    <div
      className={`markdown-body !bg-transparent !font-[inherit] !text-[inherit] ${containerClassName}`}
      data-theme={resolved}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
