import type {
  EngineDiscoveryResult,
  EngineProfile,
  EngineSettings,
  BusyAction,
  PermissionMode,
  ApiResponse,
  ExecuteIssueRequest,
  ExecuteIssueResponse,
  Issue,
  IssueChangesResponse,
  IssueFilePatchResponse,
  IssueLogsResponse,
  ProbeResult,
  Project,
} from '@/types/kanban'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const json = (await res.json()) as ApiResponse<T>
  if (!json.success) {
    throw new Error(json.error)
  }
  return json.data
}

function get<T>(url: string) {
  return request<T>(url)
}

function post<T>(url: string, body: unknown) {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) })
}

function patch<T>(url: string, body: unknown) {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body) })
}

async function postFormData<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: formData })
  const json = (await res.json()) as ApiResponse<T>
  if (!json.success) {
    throw new Error(json.error)
  }
  return json.data
}

export const kanbanApi = {
  // Filesystem
  listDirs: (path?: string) =>
    get<{ current: string; parent: string | null; dirs: string[] }>(
      `/api/filesystem/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
  createDir: (path: string, name: string) =>
    post<{ path: string }>('/api/filesystem/dirs', { path, name }),

  // Projects
  getProjects: () => get<Project[]>('/api/projects'),
  getProject: (id: string) => get<Project>(`/api/projects/${id}`),
  createProject: (data: {
    name: string
    alias?: string
    description?: string
    directory?: string
    repositoryUrl?: string
  }) => post<Project>('/api/projects', data),
  updateProject: (
    id: string,
    data: {
      name?: string
      description?: string
      directory?: string
      repositoryUrl?: string
    },
  ) => patch<Project>(`/api/projects/${id}`, data),

  // Issues
  getIssues: (projectId: string) =>
    get<Issue[]>(`/api/projects/${projectId}/issues`),
  getChildIssues: (projectId: string, parentId: string) =>
    get<Issue[]>(
      `/api/projects/${projectId}/issues?parentId=${encodeURIComponent(parentId)}`,
    ),
  createIssue: (
    projectId: string,
    data: {
      title: string
      statusId: string
      priority?: string
      useWorktree?: boolean
      parentIssueId?: string
      engineType?: string
      model?: string
      permissionMode?: string
    },
  ) => post<Issue>(`/api/projects/${projectId}/issues`, data),
  updateIssue: (projectId: string, id: string, data: Partial<Issue>) =>
    patch<Issue>(`/api/projects/${projectId}/issues/${id}`, data),
  bulkUpdateIssues: (
    projectId: string,
    updates: Array<{
      id: string
      statusId?: string
      sortOrder?: number
    }>,
  ) => patch<Issue[]>(`/api/projects/${projectId}/issues/bulk`, { updates }),

  getIssue: (projectId: string, issueId: string) =>
    get<Issue>(`/api/projects/${projectId}/issues/${issueId}`),

  // Issue session operations (merged from sessions)
  executeIssue: (
    projectId: string,
    issueId: string,
    data: ExecuteIssueRequest,
  ) =>
    post<ExecuteIssueResponse>(
      `/api/projects/${projectId}/issues/${issueId}/execute`,
      data,
    ),

  followUpIssue: (
    projectId: string,
    issueId: string,
    prompt: string,
    model?: string,
    permissionMode?: PermissionMode,
    busyAction?: BusyAction,
    files?: File[],
  ) => {
    if (files && files.length > 0) {
      const fd = new FormData()
      fd.append('prompt', prompt)
      if (model) fd.append('model', model)
      if (permissionMode) fd.append('permissionMode', permissionMode)
      if (busyAction) fd.append('busyAction', busyAction)
      for (const file of files) fd.append('files', file)
      return postFormData<ExecuteIssueResponse>(
        `/api/projects/${projectId}/issues/${issueId}/follow-up`,
        fd,
      )
    }
    return post<ExecuteIssueResponse>(
      `/api/projects/${projectId}/issues/${issueId}/follow-up`,
      {
        prompt,
        ...(model ? { model } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(busyAction ? { busyAction } : {}),
      },
    )
  },

  cancelIssue: (projectId: string, issueId: string) =>
    post<{ issueId: string; status: string }>(
      `/api/projects/${projectId}/issues/${issueId}/cancel`,
      {},
    ),

  restartIssue: (projectId: string, issueId: string) =>
    post<ExecuteIssueResponse>(
      `/api/projects/${projectId}/issues/${issueId}/restart`,
      {},
    ),

  getIssueLogs: (projectId: string, issueId: string) =>
    get<IssueLogsResponse>(`/api/projects/${projectId}/issues/${issueId}/logs`),
  getIssueChanges: (projectId: string, issueId: string) =>
    get<IssueChangesResponse>(
      `/api/projects/${projectId}/issues/${issueId}/changes`,
    ),
  getIssueFilePatch: (projectId: string, issueId: string, path: string) =>
    get<IssueFilePatchResponse>(
      `/api/projects/${projectId}/issues/${issueId}/changes/file?path=${encodeURIComponent(path)}`,
    ),

  // Engines
  getEngineAvailability: () =>
    get<EngineDiscoveryResult>('/api/engines/available'),
  getEngineProfiles: () => get<EngineProfile[]>('/api/engines/profiles'),
  getEngineSettings: () => get<EngineSettings>('/api/engines/settings'),
  updateEngineModelSetting: (
    engineType: string,
    data: { defaultModel: string },
  ) =>
    patch<{ engineType: string; defaultModel: string }>(
      `/api/engines/${encodeURIComponent(engineType)}/settings`,
      data,
    ),
  updateDefaultEngine: (defaultEngine: string) =>
    post<{ defaultEngine: string }>('/api/engines/default-engine', {
      defaultEngine,
    }),
  probeEngines: () => post<ProbeResult>('/api/engines/probe', {}),

  // App Settings
  getWorkspacePath: () => get<{ path: string }>('/api/settings/workspace-path'),
  updateWorkspacePath: (path: string) =>
    patch<{ path: string }>('/api/settings/workspace-path', { path }),
}
