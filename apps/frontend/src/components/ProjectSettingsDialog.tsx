import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
import { useDeleteProject, useUpdateProject } from '@/hooks/use-kanban'
import type { Project } from '@/types/kanban'

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [directory, setDirectory] = useState(project.directory ?? '')
  const [repositoryUrl, setRepositoryUrl] = useState(
    project.repositoryUrl ?? '',
  )
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description ?? '')
      setDirectory(project.directory ?? '')
      setRepositoryUrl(project.repositoryUrl ?? '')
      setError('')
      setShowDeleteConfirm(false)
      setDeleteConfirmName('')
    }
  }, [open, project])

  const hasChanges =
    name.trim() !== project.name ||
    description.trim() !== (project.description ?? '') ||
    directory.trim() !== (project.directory ?? '') ||
    repositoryUrl.trim() !== (project.repositoryUrl ?? '')

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setError('')
    updateProject.mutate(
      {
        id: project.id,
        name: trimmedName,
        description: description.trim() || undefined,
        directory: directory.trim() || undefined,
        repositoryUrl: repositoryUrl.trim() || undefined,
      },
      {
        onSuccess: () => onOpenChange(false),
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>{t('project.settings')}</DialogTitle>
            <DialogDescription className="mt-1">
              {t('project.settingsDescription')}
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
            onClick={handleSave}
            disabled={updateProject.isPending || !name.trim() || !hasChanges}
          >
            {updateProject.isPending
              ? t('project.saving')
              : t('project.saveChanges')}
          </Button>

          <div className="border-t pt-4">
            {!showDeleteConfirm ? (
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t('project.delete')}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  {t('project.deleteConfirm')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('project.deleteConfirmHint', { name: project.name })}
                </p>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={t('project.deleteConfirmPlaceholder')}
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteConfirmName('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    className="flex-1"
                    variant="destructive"
                    disabled={
                      deleteConfirmName !== project.name ||
                      deleteProject.isPending
                    }
                    onClick={() => {
                      deleteProject.mutate(project.id, {
                        onSuccess: () => {
                          onOpenChange(false)
                          void navigate('/')
                        },
                        onError: (err) => setError(err.message),
                      })
                    }}
                  >
                    {deleteProject.isPending
                      ? t('project.deleting')
                      : t('project.delete')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
