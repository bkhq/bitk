import { ArrowUp, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { kanbanApi } from '@/lib/kanban-api'

interface DirectoryPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath?: string
  onSelect: (path: string) => void
}

interface DirData {
  current: string
  parent: string | null
  dirs: string[]
}

export function DirectoryPicker({
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: DirectoryPickerProps) {
  const { t } = useTranslation()
  const [dirData, setDirData] = useState<DirData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchDirs = async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await kanbanApi.listDirs(path)
      setDirData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load directories')
    } finally {
      setLoading(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (open) {
      void fetchDirs(initialPath || undefined)
    } else {
      setDirData(null)
      setError(null)
      setShowNewFolder(false)
      setNewFolderName('')
    }
  }, [open, initialPath])

  const handleNavigate = (dir: string) => {
    if (dirData) {
      void fetchDirs(`${dirData.current}/${dir}`)
    }
  }

  const handleParent = () => {
    if (dirData?.parent) {
      void fetchDirs(dirData.parent)
    }
  }

  const handleSelect = () => {
    if (dirData) {
      onSelect(dirData.current)
      onOpenChange(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!dirData || !newFolderName.trim()) return
    setCreating(true)
    try {
      const result = await kanbanApi.createDir(
        dirData.current,
        newFolderName.trim(),
      )
      setShowNewFolder(false)
      setNewFolderName('')
      void fetchDirs(result.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create directory')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[calc(100%-2rem)] md:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div>
            <DialogTitle>{t('directory.browse')}</DialogTitle>
            <DialogDescription className="mt-1">
              {t('directory.browseDescription')}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>

        <div className="px-5 pb-5 pt-2">
          {/* Current path */}
          <div className="mb-3 flex items-center gap-2">
            <div className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground break-all">
              {dirData?.current ?? '...'}
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                setShowNewFolder(!showNewFolder)
                setNewFolderName('')
              }}
              disabled={!dirData || loading}
              title={t('directory.newFolder')}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>

          {/* New folder input */}
          {showNewFolder && (
            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('directory.folderName')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFolder()
                  if (e.key === 'Escape') {
                    setShowNewFolder(false)
                    setNewFolderName('')
                  }
                }}
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creating}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t('directory.create')
                )}
              </Button>
            </div>
          )}

          {/* Directory listing */}
          <div className="mb-4 max-h-64 overflow-y-auto rounded-md border">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-center text-sm text-destructive">
                {error}
              </div>
            ) : (
              <div className="divide-y">
                {dirData?.parent && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                    onClick={handleParent}
                  >
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">..</span>
                  </button>
                )}
                {dirData?.dirs.length === 0 && !dirData.parent && (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {t('directory.noSubdirs')}
                  </div>
                )}
                {dirData?.dirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                    onClick={() => handleNavigate(dir)}
                  >
                    <Folder className="h-4 w-4 text-blue-500" />
                    <span>{dir}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSelect}
              disabled={!dirData || loading}
            >
              {t('common.select')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
