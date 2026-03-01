import { FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCreateProject, useWorkspacePath } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
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
  const [detectingRemote, setDetectingRemote] = useState(false)
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

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('project.create')}</DialogTitle>
          <DialogDescription>
            {t('project.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <Label>
              {t('project.name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('project.namePlaceholder')}
              autoFocus
              className="w-full"
            />
          </Field>

          <Field>
            <Label>{t('project.alias')}</Label>
            <Input
              type="text"
              value={alias}
              onChange={(e) =>
                setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))
              }
              placeholder={t('project.aliasPlaceholder')}
              className="w-full"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('project.aliasHint')}
            </p>
          </Field>

          <Field>
            <Label>{t('project.description')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('project.descriptionPlaceholder')}
              rows={3}
              className="w-full resize-none"
            />
          </Field>

          <Field>
            <Label>{t('project.directory')}</Label>
            <div className="flex gap-1.5">
              <Input
                type="text"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder={t('project.directoryPlaceholder')}
                className="w-full"
              />
              <Button
                onClick={() => setDirPickerOpen(true)}
                variant="outline"
                size="icon"
                title={t('project.browseDirectories')}
              >
                <FolderOpen className="size-4 text-muted-foreground" />
              </Button>
            </div>
            <DirectoryPicker
              open={dirPickerOpen}
              onOpenChange={setDirPickerOpen}
              initialPath={directory || undefined}
              onSelect={setDirectory}
            />
          </Field>

          <Field>
            <Label>{t('project.repositoryUrl')}</Label>
            <div className="flex gap-1.5">
              <Input
                type="text"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder={t('project.repositoryUrlPlaceholder')}
                className="w-full"
              />
              <Button
                onClick={async () => {
                  const dir = directory.trim()
                  if (!dir) return
                  setDetectingRemote(true)
                  try {
                    const result = await kanbanApi.detectGitRemote(dir)
                    setRepositoryUrl(result.url)
                  } catch {
                    // silently ignore — directory may not be a git repo
                  } finally {
                    setDetectingRemote(false)
                  }
                }}
                variant="outline"
                type="button"
                disabled={!directory.trim() || detectingRemote}
                title={t('project.detectGitRemote')}
                className="shrink-0"
              >
                {detectingRemote ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Auto'
                )}
              </Button>
            </div>
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={createProject.isPending || !name.trim()}
          >
            {createProject.isPending
              ? t('project.creating')
              : t('project.createButton')}
          </Button>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
