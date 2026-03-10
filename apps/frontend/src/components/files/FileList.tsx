import { File, Folder, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  onDelete?: (name: string, type: 'file' | 'directory') => void
  isDeleting?: boolean
  breadcrumb?: React.ReactNode
}

export function FileList({ entries, onNavigate, onDelete, isDeleting, breadcrumb }: FileListProps) {
  const { t } = useTranslation()
  const [deleteTarget, setDeleteTarget] = useState<{ name: string, type: 'file' | 'directory' } | null>(null)

  if (entries.length === 0) {
    return (
      <div className="overflow-auto flex-1 min-h-0">
        {breadcrumb && (
          <div className="sticky top-0 z-[2] bg-muted/50 px-4 py-1.5">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          {t('fileBrowser.emptyDirectory')}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1]">
          {breadcrumb && (
            <tr className="bg-muted/50 border-b border-border">
              <th colSpan={4} className="text-left px-4 py-1.5 font-normal">
                {breadcrumb}
              </th>
            </tr>
          )}
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left font-medium text-muted-foreground px-4 py-2">
              {t('fileBrowser.name')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-24">
              {t('fileBrowser.size')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-28 hidden sm:table-cell">
              {t('fileBrowser.modified')}
            </th>
            {onDelete && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr
              key={entry.name}
              className="group/row border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => onNavigate(entry.name, entry.type)}
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {entry.type === 'directory'
                    ? <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                    : <File className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span
                    className={`truncate ${
                      entry.type === 'directory' ? 'text-foreground font-medium' : 'text-foreground'
                    }`}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {entry.type === 'file' ? formatSize(entry.size) : '—'}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground hidden sm:table-cell">
                {formatDate(entry.modifiedAt)}
              </td>
              {onDelete && (
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="p-1 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    title={t('fileBrowser.delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget({ name: entry.name, type: entry.type })
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'directory'
                ? t('fileBrowser.deleteConfirmDirDesc', { name: deleteTarget?.name })
                : t('fileBrowser.deleteConfirmDesc', { name: deleteTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={() => {
                if (deleteTarget) {
                  onDelete?.(deleteTarget.name, deleteTarget.type)
                  setDeleteTarget(null)
                }
              }}
            >
              {isDeleting ? t('fileBrowser.deleting') : t('fileBrowser.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
