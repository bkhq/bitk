import { FolderOpen, GitBranch, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  useDeleteProject,
  useDeleteWorktree,
  useProjectWorktrees,
  useUpdateProject,
} from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import type { Project } from '@/types/kanban'

function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState('')
  const deleteProject = useDeleteProject()

  useEffect(() => {
    if (!open) {
      setConfirmName('')
      setError('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {t('project.delete')}
          </DialogTitle>
          <DialogDescription>{t('project.deleteConfirm')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('project.deleteConfirmHint', { name: project.name })}
          </p>
          <Input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={t('project.deleteConfirmPlaceholder')}
            className="w-full"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={
              confirmName.trim() !== project.name.trim() ||
              deleteProject.isPending
            }
            onClick={() => {
              setError('')
              deleteProject.mutate(project.id, {
                onSuccess: onDeleted,
                onError: (err) => setError(err.message),
              })
            }}
          >
            {deleteProject.isPending
              ? t('project.deleting')
              : t('project.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorktreeTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const { data: worktrees, isLoading } = useProjectWorktrees(project.id)
  const deleteWorktree = useDeleteWorktree()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('project.worktreeLoading')}
      </div>
    )
  }

  if (!worktrees || worktrees.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('project.worktreeEmpty')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {worktrees.map((wt) => (
        <div
          key={wt.issueId}
          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium font-mono">
              {wt.issueId}
            </p>
            {wt.branch ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="size-3" />
                <span className="truncate">{wt.branch}</span>
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            disabled={deleteWorktree.isPending && deletingId === wt.issueId}
            onClick={() => {
              if (
                !window.confirm(
                  t('project.worktreeDeleteConfirm', {
                    issueId: wt.issueId,
                  }),
                )
              ) {
                return
              }
              setDeletingId(wt.issueId)
              deleteWorktree.mutate(
                { projectId: project.id, issueId: wt.issueId },
                { onSettled: () => setDeletingId(null) },
              )
            }}
          >
            {deleteWorktree.isPending && deletingId === wt.issueId ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </div>
      ))}
    </div>
  )
}

function envVarsToText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function textToEnvVars(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key) result[key] = val
  }
  return result
}

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
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? '')
  const [envVarsText, setEnvVarsText] = useState(
    envVarsToText(project.envVars ?? {}),
  )
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const [detectingRemote, setDetectingRemote] = useState(false)
  const [error, setError] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const updateProject = useUpdateProject()
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description ?? '')
      setDirectory(project.directory ?? '')
      setRepositoryUrl(project.repositoryUrl ?? '')
      setSystemPrompt(project.systemPrompt ?? '')
      setEnvVarsText(envVarsToText(project.envVars ?? {}))
      setError('')
    }
  }, [open, project])

  const hasChanges =
    name.trim() !== project.name ||
    description.trim() !== (project.description ?? '') ||
    directory.trim() !== (project.directory ?? '') ||
    repositoryUrl.trim() !== (project.repositoryUrl ?? '') ||
    systemPrompt !== (project.systemPrompt ?? '') ||
    envVarsText !== envVarsToText(project.envVars ?? {})

  const handleSave = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setError('')
    const cleanedEnvVars = textToEnvVars(envVarsText)
    updateProject.mutate(
      {
        id: project.id,
        name: trimmedName,
        description: description.trim() || undefined,
        directory: directory.trim() || undefined,
        repositoryUrl: repositoryUrl.trim() || undefined,
        systemPrompt: systemPrompt || undefined,
        envVars: cleanedEnvVars,
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <div>
              <DialogTitle>{t('project.settings')}</DialogTitle>
              <DialogDescription>
                {t('project.settingsDescription')}
              </DialogDescription>
            </div>
          </DialogHeader>

          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">
                {t('project.tabGeneral')}
              </TabsTrigger>
              <TabsTrigger value="prompt">
                {t('project.tabPrompt')}
              </TabsTrigger>
              <TabsTrigger value="envvars">
                {t('project.tabEnvVars')}
              </TabsTrigger>
              <TabsTrigger value="worktrees">
                {t('project.tabWorktrees')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <FieldGroup>
                <Field>
                  <Label>
                    {t('project.name')}{' '}
                    <span className="text-destructive">*</span>
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

                <Field className="space-y-1.5">
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

                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </FieldGroup>

              <DialogFooter className="mt-4">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  {t('project.delete')}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    updateProject.isPending || !name.trim() || !hasChanges
                  }
                >
                  {updateProject.isPending
                    ? t('project.saving')
                    : t('project.saveChanges')}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="prompt">
              <FieldGroup>
                <Field>
                  <Label>{t('project.systemPrompt')}</Label>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={t('project.systemPromptPlaceholder')}
                    rows={8}
                    className="w-full resize-y font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('project.systemPromptHint')}
                  </p>
                </Field>
              </FieldGroup>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    updateProject.isPending || !name.trim() || !hasChanges
                  }
                >
                  {updateProject.isPending
                    ? t('project.saving')
                    : t('project.saveChanges')}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="envvars">
              <FieldGroup>
                <Field>
                  <Label>{t('project.envVars')}</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('project.envVarsHint')}
                  </p>
                  <Textarea
                    value={envVarsText}
                    onChange={(e) => setEnvVarsText(e.target.value)}
                    placeholder={t('project.envVarsPlaceholder')}
                    rows={8}
                    className="w-full resize-y font-mono text-xs"
                  />
                </Field>
              </FieldGroup>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    updateProject.isPending || !name.trim() || !hasChanges
                  }
                >
                  {updateProject.isPending
                    ? t('project.saving')
                    : t('project.saveChanges')}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="worktrees">
              <WorktreeTab project={project} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        project={project}
        onDeleted={() => {
          setDeleteDialogOpen(false)
          onOpenChange(false)
          void navigate('/')
        }}
      />
    </>
  )
}
