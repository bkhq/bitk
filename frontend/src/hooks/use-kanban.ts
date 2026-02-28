import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExecuteIssueRequest, Issue } from '@/types/kanban'
import { kanbanApi } from '@/lib/kanban-api'
import { useBoardStore } from '@/stores/board-store'

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
    [
      'projects',
      projectId,
      'issues',
      issueId,
      'changes',
      'file',
      path,
    ] as const,
  childIssues: (projectId: string, parentId: string) =>
    ['projects', projectId, 'issues', 'children', parentId] as const,
  slashCommands: (projectId: string, issueId: string) =>
    ['projects', projectId, 'issues', issueId, 'slash-commands'] as const,
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => kanbanApi.getProjects(),
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

export function useIssueChanges(
  projectId: string,
  issueId: string,
  enabled = true,
) {
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
      statusId: string
      priority?: string
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
    mutationFn: (
      data: { id: string } & Partial<
        Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>
      >,
    ) => {
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
      const previous = queryClient.getQueryData<Issue[]>(
        queryKeys.issues(projectId),
      )

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
    mutationFn: (issueId: string) =>
      kanbanApi.autoTitleIssue(projectId, issueId),
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
    },
  })
}

export function useSlashCommands(
  projectId: string,
  issueId: string,
  enabled = false,
) {
  return useQuery({
    queryKey: queryKeys.slashCommands(projectId, issueId),
    queryFn: () => kanbanApi.getSlashCommands(projectId, issueId),
    enabled: !!projectId && !!issueId && enabled,
    staleTime: 60_000,
  })
}

export function useGlobalSlashCommands() {
  return useQuery({
    queryKey: ['settings', 'slash-commands'],
    queryFn: () => kanbanApi.getSlashCommandSettings(),
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
    mutationFn: (defaultEngine: string) =>
      kanbanApi.updateDefaultEngine(defaultEngine),
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
