import { File, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileEntry } from '@/types/kanban'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  if (diffDays < 30) {
    return `${diffDays}d ago`
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

interface FileListProps {
  entries: FileEntry[]
  onNavigate: (name: string, type: 'file' | 'directory') => void
}

export function FileList({ entries, onNavigate }: FileListProps) {
  const { t } = useTranslation()

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {t('fileBrowser.emptyDirectory')}
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left font-medium text-muted-foreground px-4 py-2">
              {t('fileBrowser.name')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-24 hidden sm:table-cell">
              {t('fileBrowser.size')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-28 hidden md:table-cell">
              {t('fileBrowser.modified')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.name}
              className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => onNavigate(entry.name, entry.type)}
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {entry.type === 'directory' ? (
                    <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <File className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className={`truncate ${
                      entry.type === 'directory'
                        ? 'text-foreground font-medium'
                        : 'text-foreground'
                    }`}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground hidden sm:table-cell">
                {entry.type === 'file' ? formatSize(entry.size) : '—'}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground hidden md:table-cell">
                {formatDate(entry.modifiedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
