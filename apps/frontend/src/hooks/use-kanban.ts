import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import { useBoardStore } from '@/stores/board-store'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { ExecuteIssueRequest, Issue, WebhookEventType } from '@/types/kanban'

export const queryKeys = {
  workspacePath: () => ['settings', 'workspacePath'] as const,
  engineAvailability: () => ['engines', 'availability'] as const,
  engineProfiles: () => ['engines', 'profiles'] as const,
  engineSettings: () => ['engines', 'settings'] as const,
  projects: () => ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  issues: (projectId: string) => ['projects', projectId, 'issues'] as const,
  issue: (projectId: string, issueId: string) =>
    ['projects', projectId, 'issues', issueId] as const,
  issueChanges: (projectId: string, issueId: string) =>
    ['projects', projectId, 'issues', issueId, 'changes'] as const,
  issueFilePatch: (projectId: string, issueId: string, path: string) =>
    ['projects', projectId, 'issues', issueId, 'changes', 'file', path] as const,
  childIssues: (projectId: string, parentId: string) =>
    ['projects', projectId, 'issues', 'children', parentId] as const,
  slashCommands: (projectId: string, issueId: string) =>
    ['projects', projectId, 'issues', issueId, 'slash-commands'] as const,
  projectFiles: (projectId: string, path: string, hideIgnored: boolean, rootPath?: string | null) =>
    ['projects', projectId, 'files', path, { hideIgnored, rootPath: rootPath ?? null }] as const,
  projectProcesses: (projectId: string) => ['projects', projectId, 'processes'] as const,
  projectWorktrees: (projectId: string) => ['projects', projectId, 'worktrees'] as const,
  logPageSize: () => ['settings', 'logPageSize'] as const,
  worktreeAutoCleanup: () => ['settings', 'worktreeAutoCleanup'] as const,
  maxConcurrentExecutions: () =>
    ['settings', 'maxConcurrentExecutions'] as const,
  upgradeVersion: () => ['upgrade', 'version'] as const,
  upgradeEnabled: () => ['upgrade', 'enabled'] as const,
  upgradeCheck: () => ['upgrade', 'check'] as const,
  upgradeDownloadStatus: () => ['upgrade', 'downloadStatus'] as const,
  systemLogs: () => ['settings', 'systemLogs'] as const,
  cleanupStats: () => ['settings', 'cleanupStats'] as const,
  deletedIssues: () => ['settings', 'deletedIssues'] as const,
  serverInfo: () => ['settings', 'serverInfo'] as const,
  systemInfo: () => ['settings', 'systemInfo'] as const,
  reviewIssues: () => ['issues', 'review'] as const,
  webhooks: () => ['settings', 'webhooks'] as const,
  webhookDeliveries: (id: string) => ['settings', 'webhooks', id, 'deliveries'] as const,
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => kanbanApi.getProjects(),
  })
}

export function useReviewIssues() {
  return useQuery({
    queryKey: queryKeys.reviewIssues(),
    queryFn: () => kanbanApi.getReviewIssues(),
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      alias?: string
      description?: string
      directory?: string
      repositoryUrl?: string
    }) => kanbanApi.createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id: string
      name?: string
      description?: string
      directory?: string
      repositoryUrl?: string
      systemPrompt?: string
      envVars?: Record<string, string>
    }) => {
      const { id, ...rest } = data
      return kanbanApi.updateProject(id, rest)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(variables.id),
      })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

export function useProjectWorktrees(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectWorktrees(projectId),
    queryFn: () => kanbanApi.getWorktrees(projectId),
    enabled: !!projectId,
  })
}

export function useDeleteWorktree() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { projectId: string; issueId: string }) =>
      kanbanApi.deleteWorktree(data.projectId, data.issueId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectWorktrees(variables.projectId),
      })
    },
  })
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => kanbanApi.getProject(projectId),
    enabled: !!projectId,
  })
}

export function useIssues(projectId: string) {
  return useQuery({
    queryKey: queryKeys.issues(projectId),
    queryFn: () => kanbanApi.getIssues(projectId),
    enabled: !!projectId,
  })
}

export function useIssue(projectId: string, issueId: string) {
  return useQuery({
    queryKey: queryKeys.issue(projectId, issueId),
    queryFn: () => kanbanApi.getIssue(projectId, issueId),
    enabled: !!projectId && !!issueId,
  })
}

export function useIssueChanges(projectId: string, issueId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.issueChanges(projectId, issueId),
    queryFn: () => kanbanApi.getIssueChanges(projectId, issueId),
    enabled: !!projectId && !!issueId && enabled,
  })
}

export function useIssueFilePatch(
  projectId: string,
  issueId: string,
  path: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.issueFilePatch(projectId, issueId, path ?? ''),
    queryFn: () => kanbanApi.getIssueFilePatch(projectId, issueId, path ?? ''),
    enabled: !!projectId && !!issueId && !!path && enabled,
  })
}

export function useChildIssues(projectId: string, parentIssueId: string) {
  return useQuery({
    queryKey: queryKeys.childIssues(projectId, parentIssueId),
    queryFn: () => kanbanApi.getChildIssues(projectId, parentIssueId),
    enabled: !!projectId && !!parentIssueId,
  })
}

export function useCreateIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      title: string
      tags?: string[]
      statusId: string
      useWorktree?: boolean
      parentIssueId?: string
      engineType?: string
      model?: string
      permissionMode?: string
    }) => kanbanApi.createIssue(projectId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
      if (variables.parentIssueId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.childIssues(projectId, variables.parentIssueId),
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.issue(projectId, variables.parentIssueId),
        })
      }
    },
  })
}

export function useUpdateIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string } & Partial<Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>>) => {
      const { id, ...rest } = data
      return kanbanApi.updateIssue(projectId, id, rest)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, variables.id),
      })
    },
  })
}

export function useBulkUpdateIssues(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (
      updates: Array<{
        id: string
        statusId?: string
        sortOrder?: number
      }>,
    ) => kanbanApi.bulkUpdateIssues(projectId, updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.issues(projectId),
      })
      const previous = queryClient.getQueryData<Issue[]>(queryKeys.issues(projectId))

      if (previous) {
        const updated = previous.map((issue) => {
          const update = updates.find((u) => u.id === issue.id)
          if (update) {
            const { id: _, ...fields } = update
            return {
              ...issue,
              ...fields,
              updatedAt: new Date().toISOString(),
            }
          }
          return issue
        })
        queryClient.setQueryData(queryKeys.issues(projectId), updated)
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.issues(projectId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
      useBoardStore.getState().resetDragging()
    },
  })
}

export function useDeleteIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => kanbanApi.deleteIssue(projectId, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
    },
  })
}

// --- Issue session hooks ---

export function useExecuteIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { issueId: string; data: ExecuteIssueRequest }) =>
      kanbanApi.executeIssue(projectId, args.issueId, args.data),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, args.issueId),
      })
    },
  })
}

export function useFollowUpIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      issueId: string
      prompt: string
      model?: string
      permissionMode?: 'auto' | 'supervised' | 'plan'
      busyAction?: 'queue' | 'cancel'
      files?: File[]
    }) =>
      kanbanApi.followUpIssue({
        projectId,
        issueId: args.issueId,
        prompt: args.prompt,
        model: args.model,
        permissionMode: args.permissionMode,
        busyAction: args.busyAction,
        files: args.files,
      }),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, args.issueId),
      })
    },
  })
}

export function useAutoTitleIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => kanbanApi.autoTitleIssue(projectId, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues(projectId),
      })
    },
  })
}

export function useRestartIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => kanbanApi.restartIssue(projectId, issueId),
    onSuccess: (_data, issueId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, issueId),
      })
    },
  })
}

export function useCancelIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => kanbanApi.cancelIssue(projectId, issueId),
    onSuccess: (_data, issueId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, issueId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues(projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectProcesses(projectId),
      })
    },
  })
}

export function useSlashCommands(projectId: string, issueId: string, enabled = false) {
  return useQuery({
    queryKey: queryKeys.slashCommands(projectId, issueId),
    queryFn: () => kanbanApi.getSlashCommands(projectId, issueId),
    enabled: !!projectId && !!issueId && enabled,
    staleTime: 60_000,
  })
}

export function useGlobalSlashCommands(engine?: string | null) {
  return useQuery({
    queryKey: ['settings', 'slash-commands', engine ?? 'all'],
    queryFn: () => kanbanApi.getSlashCommandSettings(engine ?? undefined),
    enabled: !!engine,
    staleTime: Infinity,
  })
}

// --- Engine hooks ---

export function useEngineAvailability(enabled = false) {
  return useQuery({
    queryKey: queryKeys.engineAvailability(),
    queryFn: () => kanbanApi.getEngineAvailability(),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useEngineProfiles(enabled = false) {
  return useQuery({
    queryKey: queryKeys.engineProfiles(),
    queryFn: () => kanbanApi.getEngineProfiles(),
    enabled,
    staleTime: Infinity,
  })
}

export function useEngineSettings(enabled = false) {
  return useQuery({
    queryKey: queryKeys.engineSettings(),
    queryFn: () => kanbanApi.getEngineSettings(),
    enabled,
    staleTime: 30_000,
  })
}

export function useUpdateEngineModelSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { engineType: string; defaultModel: string }) =>
      kanbanApi.updateEngineModelSetting(args.engineType, {
        defaultModel: args.defaultModel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engineSettings() })
    },
  })
}

export function useUpdateDefaultEngine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (defaultEngine: string) => kanbanApi.updateDefaultEngine(defaultEngine),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.engineSettings() })
    },
  })
}

export function useProbeEngines() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => kanbanApi.probeEngines(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.engineAvailability(),
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.engineSettings() })
    },
  })
}

// --- App Settings hooks ---

export function useWorkspacePath(enabled = false) {
  return useQuery({
    queryKey: queryKeys.workspacePath(),
    queryFn: () => kanbanApi.getWorkspacePath(),
    enabled,
    staleTime: Infinity,
  })
}

export function useUpdateWorkspacePath() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => kanbanApi.updateWorkspacePath(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspacePath() })
    },
  })
}

// --- Worktree Auto-Cleanup hooks ---

export function useLogPageSize(enabled = false) {
  return useQuery({
    queryKey: queryKeys.logPageSize(),
    queryFn: () => kanbanApi.getLogPageSize(),
    enabled,
    staleTime: Infinity,
  })
}

export function useSetLogPageSize() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (size: number) => kanbanApi.setLogPageSize(size),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.logPageSize(),
      })
    },
  })
}

export function useWorktreeAutoCleanup(enabled = false) {
  return useQuery({
    queryKey: queryKeys.worktreeAutoCleanup(),
    queryFn: () => kanbanApi.getWorktreeAutoCleanup(),
    enabled,
    staleTime: Infinity,
  })
}

export function useSetWorktreeAutoCleanup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => kanbanApi.setWorktreeAutoCleanup(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.worktreeAutoCleanup(),
      })
    },
  })
}

// --- Max Concurrent Executions hooks ---

export function useMaxConcurrentExecutions(enabled = false) {
  return useQuery({
    queryKey: queryKeys.maxConcurrentExecutions(),
    queryFn: () => kanbanApi.getMaxConcurrentExecutions(),
    enabled,
    staleTime: Infinity,
  })
}

export function useSetMaxConcurrentExecutions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (value: number) => kanbanApi.setMaxConcurrentExecutions(value),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.maxConcurrentExecutions(),
      })
    },
  })
}

// --- Server Info hooks ---

export function useServerInfo(enabled = false) {
  return useQuery({
    queryKey: queryKeys.serverInfo(),
    queryFn: () => kanbanApi.getServerInfo(),
    enabled,
    staleTime: Infinity,
  })
}

export function useUpdateServerInfo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name?: string; url?: string }) => kanbanApi.updateServerInfo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.serverInfo() })
      queryClient.invalidateQueries({ queryKey: queryKeys.systemInfo() })
    },
  })
}

// --- System Logs hooks ---

export function useSystemLogs(enabled = false, lines = 200) {
  return useQuery({
    queryKey: queryKeys.systemLogs(),
    queryFn: () => kanbanApi.getSystemLogs(lines),
    enabled,
    staleTime: 10_000,
  })
}

export function useClearSystemLogs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => kanbanApi.clearSystemLogs(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.systemLogs() })
    },
  })
}

// --- Cleanup hooks ---

export function useCleanupStats(enabled = false) {
  return useQuery({
    queryKey: queryKeys.cleanupStats(),
    queryFn: () => kanbanApi.getCleanupStats(),
    enabled,
    staleTime: 30_000,
  })
}

export function useRunCleanup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (targets: Array<'logs' | 'oldVersions' | 'worktrees' | 'deletedIssues'>) =>
      kanbanApi.runCleanup(targets),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cleanupStats() })
      queryClient.invalidateQueries({ queryKey: queryKeys.deletedIssues() })
    },
  })
}

// --- Recycle Bin hooks ---

export function useDeletedIssues(enabled = false) {
  return useQuery({
    queryKey: queryKeys.deletedIssues(),
    queryFn: () => kanbanApi.getDeletedIssues(),
    enabled,
    staleTime: 30_000,
  })
}

export function useRestoreDeletedIssue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.restoreDeletedIssue(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deletedIssues() })
      queryClient.invalidateQueries({ queryKey: queryKeys.cleanupStats() })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

// --- About / System Info hooks ---

export function useSystemInfo(enabled = false) {
  return useQuery({
    queryKey: queryKeys.systemInfo(),
    queryFn: () => kanbanApi.getSystemInfo(),
    enabled,
    staleTime: 30_000,
  })
}

// --- Upgrade hooks ---

export function useVersionInfo(enabled = false) {
  return useQuery({
    queryKey: queryKeys.upgradeVersion(),
    queryFn: () => kanbanApi.getVersionInfo(),
    enabled,
    staleTime: Infinity,
  })
}

export function useUpgradeEnabled(enabled = false) {
  return useQuery({
    queryKey: queryKeys.upgradeEnabled(),
    queryFn: () => kanbanApi.getUpgradeEnabled(),
    enabled,
    staleTime: 30_000,
  })
}

export function useSetUpgradeEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => kanbanApi.setUpgradeEnabled(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.upgradeEnabled() })
    },
  })
}

export function useUpgradeCheck(enabled = false) {
  return useQuery({
    queryKey: queryKeys.upgradeCheck(),
    queryFn: () => kanbanApi.getUpgradeCheck(),
    enabled,
    staleTime: 60_000,
  })
}

export function useCheckForUpdates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => kanbanApi.checkForUpdates(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.upgradeCheck() })
    },
  })
}

export function useDownloadUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { url: string; fileName: string; checksumUrl?: string }) =>
      kanbanApi.downloadUpdate(args.url, args.fileName, args.checksumUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.upgradeDownloadStatus(),
      })
    },
  })
}

export function useDownloadStatus(enabled = false) {
  return useQuery({
    queryKey: queryKeys.upgradeDownloadStatus(),
    queryFn: () => kanbanApi.getDownloadStatus(),
    enabled,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.status === 'downloading' || data?.status === 'verifying' ? 1000 : false
    },
  })
}

export function useRestartWithUpgrade() {
  return useMutation({
    mutationFn: () => kanbanApi.restartWithUpgrade(),
    // Use onSettled (not onSuccess) because the server typically shuts down
    // before the HTTP response is sent, causing a network error on the client.
    onSettled: () => {
      // Server is restarting — poll until it comes back, then reload.
      const poll = async () => {
        const start = Date.now()
        const timeout = 60_000
        const interval = 1_500
        // Wait for the server to fully shut down
        await new Promise((r) => setTimeout(r, 2_000))
        while (Date.now() - start < timeout) {
          try {
            const res = await fetch('/api/settings/upgrade/version')
            if (res.ok) {
              window.location.reload()
              return
            }
          } catch {
            // Server still down — keep polling
          }
          await new Promise((r) => setTimeout(r, interval))
        }
        // Timeout — reload anyway
        window.location.reload()
      }
      void poll()
    },
  })
}

// --- File Browser hooks ---

export function useProjectFiles(projectId: string, path: string, enabled = true) {
  const hideIgnored = useFileBrowserStore((s) => s.hideIgnored)
  const rootPath = useFileBrowserStore((s) => s.rootPath)
  return useQuery({
    queryKey: queryKeys.projectFiles(projectId, path, hideIgnored, rootPath),
    queryFn: () => kanbanApi.listFiles(projectId, path || undefined, hideIgnored, rootPath),
    enabled: !!projectId && enabled,
  })
}

// --- Process Manager hooks ---

export function useProjectProcesses(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectProcesses(projectId),
    queryFn: () => kanbanApi.getProjectProcesses(projectId),
    enabled: !!projectId && enabled,
    refetchInterval: 5000,
  })
}

export function useTerminateProcess(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => kanbanApi.terminateProcess(projectId, issueId),
    onSuccess: (_data, issueId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectProcesses(projectId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.issue(projectId, issueId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues(projectId),
      })
    },
  })
}

// --- Webhook hooks ---

export function useWebhooks(enabled = false) {
  return useQuery({
    queryKey: queryKeys.webhooks(),
    queryFn: () => kanbanApi.getWebhooks(),
    enabled,
    staleTime: 30_000,
  })
}

export function useCreateWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      channel?: string
      url: string
      secret?: string
      events: WebhookEventType[]
      isActive?: boolean
    }) => kanbanApi.createWebhook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks() })
    },
  })
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      id: string
      url?: string
      secret?: string | null
      events?: WebhookEventType[]
      isActive?: boolean
    }) => {
      const { id, ...rest } = data
      return kanbanApi.updateWebhook(id, rest)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks() })
    },
  })
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.webhooks() })
    },
  })
}

export function useWebhookDeliveries(id: string, enabled = false) {
  return useQuery({
    queryKey: queryKeys.webhookDeliveries(id),
    queryFn: () => kanbanApi.getWebhookDeliveries(id),
    enabled: !!id && enabled,
    staleTime: 10_000,
  })
}

export function useTestWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.testWebhook(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.webhookDeliveries(id),
      })
    },
  })
}
