import {
  Archive,
  Check,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  GitFork,
  Loader2,
  Settings,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { DirectoryPicker } from '@/components/DirectoryPicker'
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
import type { SettingsNavItem } from '@/components/ui/settings-layout'
import { SettingsLayout } from '@/components/ui/settings-layout'
import { Textarea } from '@/components/ui/textarea'
import {
  useArchiveProject,
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
          <DialogTitle className="text-destructive">{t('project.delete')}</DialogTitle>
          <DialogDescription>{t('project.deleteConfirm')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('project.deleteConfirmHint', { name: project.name })}
          </p>
          <Input
            type="text"
            value={confirmName}
            onChange={e => setConfirmName(e.target.value)}
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
            disabled={confirmName.trim() !== project.name.trim() || deleteProject.isPending}
            onClick={() => {
              setError('')
              deleteProject.mutate(project.id, {
                onSuccess: onDeleted,
                onError: err => setError(err.message),
              })
            }}
          >
            {deleteProject.isPending ? t('project.deleting') : t('project.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorktreeSection({ project }: { project: Project }) {
  const { t } = useTranslation()
  const { data: worktrees, isLoading } = useProjectWorktrees(project.id)
  const deleteWorktree = useDeleteWorktree()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

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
      <p className="py-8 text-center text-sm text-muted-foreground">{t('project.worktreeEmpty')}</p>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {worktrees.map(wt => (
          <div
            key={wt.issueId}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium font-mono">{wt.issueId}</p>
              {wt.branch ?
                  (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <GitBranch className="size-3" />
                      <span className="truncate">{wt.branch}</span>
                    </p>
                  ) :
                null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              disabled={deleteWorktree.isPending && deletingId === wt.issueId}
              onClick={() => setConfirmId(wt.issueId)}
            >
              {deleteWorktree.isPending && deletingId === wt.issueId ?
                  (
                    <Loader2 className="size-4 animate-spin" />
                  ) :
                  (
                    <Trash2 className="size-4" />
                  )}
            </Button>
          </div>
        ))}
      </div>

      <AlertDialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('project.worktreeDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('project.worktreeDeleteConfirm', {
                issueId: confirmId ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!confirmId) return
                setDeletingId(confirmId)
                deleteWorktree.mutate(
                  { projectId: project.id, issueId: confirmId },
                  { onSettled: () => setDeletingId(null) },
                )
                setConfirmId(null)
              }}
            >
              {t('project.worktreeDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const [repositoryUrl, setRepositoryUrl] = useState(project.repositoryUrl ?? '')
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? '')
  const [envVarsText, setEnvVarsText] = useState(envVarsToText(project.envVars ?? {}))
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const [detectingRemote, setDetectingRemote] = useState(false)
  const [error, setError] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const updateProject = useUpdateProject()
  const archiveProject = useArchiveProject()
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
        systemPrompt,
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

  const navItems: SettingsNavItem[] = useMemo(
    () => [
      { id: 'general', label: t('project.tabGeneral'), icon: Settings },
      { id: 'prompt', label: t('project.tabPrompt'), icon: FileText },
      { id: 'envvars', label: t('project.tabEnvVars'), icon: Terminal },
      { id: 'worktrees', label: t('project.tabWorktrees'), icon: GitFork },
    ],
    [t],
  )

  return (
    <>
      <SettingsLayout
        open={open}
        onOpenChange={onOpenChange}
        title={t('project.settings')}
        items={navItems}
        defaultItem="general"
        sidebarFooter={(
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
              {t('project.projectId')}
            </span>
            <CopyableId value={project.id} />
          </div>
        )}
        footer={active =>
          active !== 'worktrees' ?
              (
                <div className="flex items-center justify-between border-t px-5 py-3">
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                      {t('project.delete')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        archiveProject.mutate(project.id, {
                          onSuccess: () => {
                            onOpenChange(false)
                            void navigate('/')
                          },
                        })
                      }}
                      disabled={archiveProject.isPending}
                    >
                      <Archive className="size-4" />
                      {archiveProject.isPending ? t('project.archiving') : t('project.archive')}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={updateProject.isPending || !name.trim() || !hasChanges}
                    >
                      {updateProject.isPending ? t('project.saving') : t('project.saveChanges')}
                    </Button>
                  </div>
                </div>
              ) :
            null}
      >
        {active => (
          <>
            {active === 'general' && (
              <GeneralSection
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                directory={directory}
                setDirectory={setDirectory}
                repositoryUrl={repositoryUrl}
                setRepositoryUrl={setRepositoryUrl}
                dirPickerOpen={dirPickerOpen}
                setDirPickerOpen={setDirPickerOpen}
                detectingRemote={detectingRemote}
                setDetectingRemote={setDetectingRemote}
                error={error}
              />
            )}
            {active === 'prompt' && (
              <PromptSection systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />
            )}
            {active === 'envvars' && (
              <EnvVarsSection envVarsText={envVarsText} setEnvVarsText={setEnvVarsText} />
            )}
            {active === 'worktrees' && <WorktreeSection project={project} />}
          </>
        )}
      </SettingsLayout>

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

function CopyableId({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(setCopied, 1500, false)
        })
      }}
      className="group/id inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted transition-colors"
      title={t('project.copyId')}
    >
      {value}
      {copied ?
          (
            <Check className="size-3 text-green-500" />
          ) :
          (
            <Copy className="size-3 opacity-0 group-hover/id:opacity-100 transition-opacity" />
          )}
    </button>
  )
}

function GeneralSection({
  name,
  setName,
  description,
  setDescription,
  directory,
  setDirectory,
  repositoryUrl,
  setRepositoryUrl,
  dirPickerOpen,
  setDirPickerOpen,
  detectingRemote,
  setDetectingRemote,
  error,
}: {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  directory: string
  setDirectory: (v: string) => void
  repositoryUrl: string
  setRepositoryUrl: (v: string) => void
  dirPickerOpen: boolean
  setDirPickerOpen: (v: boolean) => void
  detectingRemote: boolean
  setDetectingRemote: (v: boolean) => void
  error: string
}) {
  const { t } = useTranslation()

  return (
    <FieldGroup>
      <Field>
        <Label>
          {t('project.name')}
          {' '}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('project.namePlaceholder')}
          autoFocus
          className="w-full"
        />
      </Field>

      <Field>
        <Label>{t('project.description')}</Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
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
            onChange={e => setDirectory(e.target.value)}
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
            onChange={e => setRepositoryUrl(e.target.value)}
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
            {detectingRemote ? <Loader2 className="size-4 animate-spin" /> : 'Auto'}
          </Button>
        </div>
      </Field>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </FieldGroup>
  )
}

function PromptSection({
  systemPrompt,
  setSystemPrompt,
}: {
  systemPrompt: string
  setSystemPrompt: (v: string) => void
}) {
  const { t } = useTranslation()

  return (
    <FieldGroup className="h-full">
      <Field className="flex-1">
        <Label>{t('project.systemPrompt')}</Label>
        <Textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          placeholder={t('project.systemPromptPlaceholder')}
          className="w-full flex-1 resize-none font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">{t('project.systemPromptHint')}</p>
      </Field>
    </FieldGroup>
  )
}

function EnvVarsSection({
  envVarsText,
  setEnvVarsText,
}: {
  envVarsText: string
  setEnvVarsText: (v: string) => void
}) {
  const { t } = useTranslation()

  return (
    <FieldGroup className="h-full">
      <Field className="flex-1">
        <Label>{t('project.envVars')}</Label>
        <p className="text-xs text-muted-foreground mb-2">{t('project.envVarsHint')}</p>
        <Textarea
          value={envVarsText}
          onChange={e => setEnvVarsText(e.target.value)}
          placeholder={t('project.envVarsPlaceholder')}
          className="w-full flex-1 resize-none font-mono text-xs"
        />
      </Field>
    </FieldGroup>
  )
}
