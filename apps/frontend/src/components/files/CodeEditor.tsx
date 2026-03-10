import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@uiw/react-codemirror'
import CodeMirror from '@uiw/react-codemirror'
import { useCallback, useMemo } from 'react'
import { useTheme } from '@/hooks/use-theme'

function getLanguageExtension(path: string): Extension | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const filename = path.split('/').pop()?.toLowerCase() ?? ''

  if (filename === 'dockerfile' || filename === 'makefile') return null

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'json':
      return json()
    case 'html':
    case 'htm':
      return html()
    case 'css':
    case 'scss':
      return css()
    case 'md':
    case 'mdx':
      return markdown()
    case 'py':
      return python()
    case 'go':
      return go()
    case 'rs':
      return rust()
    case 'sql':
      return sql()
    case 'xml':
    case 'svg':
      return xml()
    case 'yml':
    case 'yaml':
      return yaml()
    default:
      return null
  }
}

interface CodeEditorProps {
  value: string
  filePath: string
  onChange: (value: string) => void
  onSave?: () => void
  onCancel?: () => void
}

export function CodeEditor({ value, filePath, onChange, onSave, onCancel }: CodeEditorProps) {
  const { resolved } = useTheme()

  const extensions = useMemo(() => {
    const exts: Extension[] = []
    const lang = getLanguageExtension(filePath)
    if (lang) exts.push(lang)
    return exts
  }, [filePath])

  const handleChange = useCallback((val: string) => {
    onChange(val)
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      onSave?.()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel?.()
    }
  }, [onSave, onCancel])

  return (
    <div className="h-full w-full overflow-hidden" onKeyDown={handleKeyDown}>
      <CodeMirror
        value={value}
        height="100%"
        theme={resolved === 'dark' ? 'dark' : 'light'}
        extensions={extensions}
        onChange={handleChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          tabSize: 2,
        }}
        className="h-full text-xs [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
      />
    </div>
  )
}
