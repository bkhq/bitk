import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateProject, useWorkspacePath } from '@/hooks/use-kanban'
import type { Project } from '@/types/kanban'

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (p: Project) => void
}) {
  const { t } = useTranslation()
  const { data: wsData } = useWorkspacePath(true)
  const defaultDir = wsData?.path ?? '/'
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [description, setDescription] = useState('')
  const [directory, setDirectory] = useState(defaultDir)
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const createProject = useCreateProject()

  // Sync directory with workspace setting when dialog opens
  useEffect(() => {
    if (open) {
      setDirectory(defaultDir)
    }
  }, [open, defaultDir])

  const reset = () => {
    setName('')
    setAlias('')
    setDescription('')
    setDirectory(defaultDir)
    setRepositoryUrl('')
    setError('')
  }

  const [error, setError] = useState('')

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setError('')
    createProject.mutate(
      {
        name: trimmedName,
        alias: alias.trim() || undefined,
        description: description.trim() || undefined,
        directory: directory.trim() || undefined,
        repositoryUrl: repositoryUrl.trim() || undefined,
      },
      {
        onSuccess: (project) => {
          onCreated(project)
          onOpenChange(false)
          reset()
        },
        onError: (err) => {
          if (err.message === 'directory_already_used') {
            setError(t('project.directoryAlreadyUsed'))
          } else {
            setError(err.message)
          }
        },
      },
    )
  }

  const inputClass =
    'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring'

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>{t('project.create')}</DialogTitle>
            <DialogDescription className="mt-1">
              {t('project.createDescription')}
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>
        <div className="max-h-[85dvh] overflow-y-auto space-y-4 px-5 pb-5 pt-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('project.name')} <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('project.namePlaceholder')}
              autoFocus
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('project.alias')}
            </label>
            <input
              type="text"
              value={alias}
              onChange={(e) =>
                setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))
              }
              placeholder={t('project.aliasPlaceholder')}
              className={inputClass}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('project.aliasHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('project.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('project.descriptionPlaceholder')}
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('project.directory')}
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder={t('project.directoryPlaceholder')}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setDirPickerOpen(true)}
                className="flex shrink-0 items-center justify-center rounded-md border px-2.5 hover:bg-accent transition-colors"
                title={t('project.browseDirectories')}
              >
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <DirectoryPicker
              open={dirPickerOpen}
              onOpenChange={setDirPickerOpen}
              initialPath={directory || undefined}
              onSelect={setDirectory}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('project.repositoryUrl')}
            </label>
            <input
              type="text"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              placeholder={t('project.repositoryUrlPlaceholder')}
              className={inputClass}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button
            className="w-full"
            variant="outline"
            onClick={handleSubmit}
            disabled={createProject.isPending || !name.trim()}
          >
            {createProject.isPending
              ? t('project.creating')
              : t('project.createButton')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
