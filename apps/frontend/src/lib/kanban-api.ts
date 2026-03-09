import type {
  ApiResponse,
  BusyAction,
  CategorizedCommands,
  EngineDiscoveryResult,
  EngineProfile,
  EngineSettings,
  ExecuteIssueRequest,
  ExecuteIssueResponse,
  FileListingResult,
  Issue,
  IssueChangesResponse,
  IssueFilePatchResponse,
  IssueLogsResponse,
  Note,
  PermissionMode,
  ProbeResult,
  Project,
  ProjectProcessesResponse,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
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

function del<T>(url: string) {
  return request<T>(url, { method: 'DELETE' })
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
  // Git
  detectGitRemote: (directory: string) =>
    post<{ url: string, remote: string }>('/api/git/detect-remote', {
      directory,
    }),

  // Filesystem
  listDirs: (path?: string) =>
    get<{ current: string, parent: string | null, dirs: string[] }>(
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
    systemPrompt?: string
    envVars?: Record<string, string>
  }) => post<Project>('/api/projects', data),
  updateProject: (
    id: string,
    data: {
      name?: string
      description?: string
      directory?: string
      repositoryUrl?: string
      systemPrompt?: string
      envVars?: Record<string, string>
    },
  ) => patch<Project>(`/api/projects/${id}`, data),
  deleteProject: (id: string) => del<{ id: string }>(`/api/projects/${id}`),

  // Worktrees
  getWorktrees: (projectId: string) =>
    get<Array<{ issueId: string, path: string, branch: string | null }>>(
      `/api/projects/${projectId}/worktrees`,
    ),
  deleteWorktree: (projectId: string, issueId: string) =>
    del<{ issueId: string }>(`/api/projects/${projectId}/worktrees/${issueId}`),

  // Issues
  getReviewIssues: () =>
    get<Array<Issue & { projectName: string, projectAlias: string }>>('/api/issues/review'),
  getIssues: (projectId: string) => get<Issue[]>(`/api/projects/${projectId}/issues`),
  getChildIssues: (projectId: string, parentId: string) =>
    get<Issue[]>(`/api/projects/${projectId}/issues?parentId=${encodeURIComponent(parentId)}`),
  createIssue: (
    projectId: string,
    data: {
      title: string
      tags?: string[]
      statusId: string
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
  deleteIssue: (projectId: string, issueId: string) =>
    del<{ id: string }>(`/api/projects/${projectId}/issues/${issueId}`),

  // Issue session operations (merged from sessions)
  executeIssue: (projectId: string, issueId: string, data: ExecuteIssueRequest) =>
    post<ExecuteIssueResponse>(`/api/projects/${projectId}/issues/${issueId}/execute`, data),

  followUpIssue: (opts: {
    projectId: string
    issueId: string
    prompt: string
    model?: string
    permissionMode?: PermissionMode
    busyAction?: BusyAction
    files?: File[]
    meta?: boolean
    displayPrompt?: string
  }) => {
    if (opts.files && opts.files.length > 0) {
      const fd = new FormData()
      fd.append('prompt', opts.prompt)
      if (opts.model) fd.append('model', opts.model)
      if (opts.permissionMode) fd.append('permissionMode', opts.permissionMode)
      if (opts.busyAction) fd.append('busyAction', opts.busyAction)
      if (opts.meta) fd.append('meta', 'true')
      if (opts.displayPrompt) fd.append('displayPrompt', opts.displayPrompt)
      for (const file of opts.files) fd.append('files', file)
      return postFormData<ExecuteIssueResponse>(
        `/api/projects/${opts.projectId}/issues/${opts.issueId}/follow-up`,
        fd,
      )
    }
    return post<ExecuteIssueResponse>(
      `/api/projects/${opts.projectId}/issues/${opts.issueId}/follow-up`,
      {
        prompt: opts.prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        ...(opts.busyAction ? { busyAction: opts.busyAction } : {}),
        ...(opts.meta ? { meta: true } : {}),
        ...(opts.displayPrompt ? { displayPrompt: opts.displayPrompt } : {}),
      },
    )
  },

  cancelIssue: (projectId: string, issueId: string) =>
    post<{ issueId: string, status: string }>(
      `/api/projects/${projectId}/issues/${issueId}/cancel`,
      {},
    ),

  restartIssue: (projectId: string, issueId: string) =>
    post<ExecuteIssueResponse>(`/api/projects/${projectId}/issues/${issueId}/restart`, {}),

  deletePendingMessage: (projectId: string, issueId: string) =>
    del<{
      id: string
      content: string
      metadata: Record<string, unknown>
      attachments: Array<{
        id: string
        originalName: string
        mimeType: string
        size: number
      }>
    }>(`/api/projects/${projectId}/issues/${issueId}/pending`),

  autoTitleIssue: async (projectId: string, issueId: string) => {
    const res = await fetch(`/api/projects/${projectId}/issues/${issueId}/auto-title`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`Auto-title failed: ${res.status}`)
    return res.json()
  },

  getIssueLogs: (
    projectId: string,
    issueId: string,
    opts?: { before?: string, cursor?: string, limit?: number },
  ) => {
    const params = new URLSearchParams()
    if (opts?.before) params.set('before', opts.before)
    if (opts?.cursor) params.set('cursor', opts.cursor)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return get<IssueLogsResponse>(
      `/api/projects/${projectId}/issues/${issueId}/logs${qs ? `?${qs}` : ''}`,
    )
  },
  getSlashCommands: (projectId: string, issueId: string) =>
    get<CategorizedCommands>(`/api/projects/${projectId}/issues/${issueId}/slash-commands`),
  getIssueChanges: (projectId: string, issueId: string) =>
    get<IssueChangesResponse>(`/api/projects/${projectId}/issues/${issueId}/changes`),
  getIssueFilePatch: (projectId: string, issueId: string, path: string) =>
    get<IssueFilePatchResponse>(
      `/api/projects/${projectId}/issues/${issueId}/changes/file?path=${encodeURIComponent(path)}`,
    ),

  // Engines
  getEngineAvailability: () => get<EngineDiscoveryResult>('/api/engines/available'),
  getEngineProfiles: () => get<EngineProfile[]>('/api/engines/profiles'),
  getEngineSettings: () => get<EngineSettings>('/api/engines/settings'),
  updateEngineModelSetting: (engineType: string, data: { defaultModel: string }) =>
    patch<{ engineType: string, defaultModel: string }>(
      `/api/engines/${encodeURIComponent(engineType)}/settings`,
      data,
    ),
  updateDefaultEngine: (defaultEngine: string) =>
    patch<{ defaultEngine: string }>('/api/engines/default-engine', {
      defaultEngine,
    }),
  probeEngines: () => post<ProbeResult>('/api/engines/probe', {}),

  // App Settings
  getSlashCommandSettings: (engine?: string) =>
    get<CategorizedCommands>(
      `/api/settings/slash-commands${engine ? `?engine=${encodeURIComponent(engine)}` : ''}`,
    ),
  getWorkspacePath: () => get<{ path: string }>('/api/settings/workspace-path'),
  updateWorkspacePath: (path: string) =>
    patch<{ path: string }>('/api/settings/workspace-path', { path }),
  getLogPageSize: () => get<{ size: number }>('/api/settings/log-page-size'),
  setLogPageSize: (size: number) =>
    patch<{ size: number }>('/api/settings/log-page-size', { size }),
  getWorktreeAutoCleanup: () => get<{ enabled: boolean }>('/api/settings/worktree-auto-cleanup'),
  setWorktreeAutoCleanup: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/worktree-auto-cleanup', {
      enabled,
    }),
  getCleanupStats: () =>
    get<{
      logs: { logCount: number, toolCallCount: number }
      oldVersions: {
        items: Array<{ name: string, size: number }>
        totalSize: number
      }
      worktrees: { count: number, totalSize: number }
      deletedIssues: { issueCount: number, projectCount: number }
    }>('/api/settings/cleanup/stats'),
  runCleanup: (targets: Array<'logs' | 'oldVersions' | 'worktrees' | 'deletedIssues'>) =>
    post<Record<string, { cleaned: number }>>('/api/settings/cleanup', {
      targets,
    }),
  getDeletedIssues: () =>
    get<
      Array<{
        id: string
        title: string
        projectId: string
        projectName: string
        statusId: string
        deletedAt: string | null
      }>
    >('/api/settings/deleted-issues'),
  restoreDeletedIssue: (id: string) =>
    post<{ id: string }>(`/api/settings/deleted-issues/${id}/restore`, {}),

  // Server Info
  getServerInfo: () =>
    get<{ name: string | null, url: string | null }>('/api/settings/server-info'),
  updateServerInfo: (data: { name?: string, url?: string }) =>
    patch<{ name: string | null, url: string | null }>('/api/settings/server-info', data),

  // System Logs
  getSystemLogs: (lines = 200) =>
    get<{ lines: string[], fileSize: number, totalLines: number }>(
      `/api/settings/system-logs?lines=${lines}`,
    ),
  downloadSystemLogs: () => `/api/settings/system-logs/download`,
  clearSystemLogs: () => post<{ cleared: boolean }>('/api/settings/system-logs/clear', {}),

  // About / System Info
  getSystemInfo: () =>
    get<{
      app: {
        version: string
        commit: string
        isCompiled: boolean
        isPackageMode: boolean
        startedAt: string
        uptime: number
      }
      runtime: {
        bun: string
        platform: string
        arch: string
        nodeVersion: string
      }
      server: {
        name: string | null
        url: string | null
      }
      process: {
        pid: number
      }
    }>('/api/settings/system-info'),

  // Upgrade
  getVersionInfo: () =>
    get<{
      version: string
      commit: string
      isCompiled: boolean
      isPackageMode: boolean
    }>('/api/settings/upgrade/version'),
  getUpgradeEnabled: () => get<{ enabled: boolean }>('/api/settings/upgrade/enabled'),
  setUpgradeEnabled: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/upgrade/enabled', { enabled }),
  getUpgradeCheck: () =>
    get<{
      hasUpdate: boolean
      currentVersion: string
      currentCommit: string
      latestVersion: string | null
      latestTag: string | null
      publishedAt: string | null
      downloadUrl: string | null
      checksumUrl: string | null
      assetName: string | null
      assetSize: number | null
      downloadFileName: string | null
      checkedAt: string
    } | null>('/api/settings/upgrade/check'),
  checkForUpdates: () =>
    post<{
      hasUpdate: boolean
      currentVersion: string
      currentCommit: string
      latestVersion: string | null
      latestTag: string | null
      publishedAt: string | null
      downloadUrl: string | null
      checksumUrl: string | null
      assetName: string | null
      assetSize: number | null
      downloadFileName: string | null
      checkedAt: string
    }>('/api/settings/upgrade/check', {}),
  downloadUpdate: (url: string, fileName: string, checksumUrl?: string) =>
    post<{ status: string, fileName: string }>('/api/settings/upgrade/download', {
      url,
      fileName,
      ...(checksumUrl ? { checksumUrl } : {}),
    }),
  getDownloadStatus: () =>
    get<{
      status: 'idle' | 'downloading' | 'verifying' | 'verified' | 'completed' | 'failed'
      progress: number
      fileName: string | null
      filePath: string | null
      error: string | null
      checksumMatch: boolean | null
    }>('/api/settings/upgrade/download/status'),
  restartWithUpgrade: () => post<{ status: string }>('/api/settings/upgrade/restart', {}),

  // File Browser
  listFiles: (projectId: string, path?: string, hideIgnored?: boolean, root?: string | null) => {
    const encodedPath
      = path && path !== '.' ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''
    const params = new URLSearchParams()
    if (hideIgnored) params.set('hideIgnored', 'true')
    if (root) params.set('root', root)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return get<FileListingResult>(`/api/projects/${projectId}/files/show${encodedPath}${qs}`)
  },

  // Process Manager
  getProjectProcesses: (projectId: string) =>
    get<ProjectProcessesResponse>(`/api/projects/${projectId}/processes`),

  terminateProcess: (projectId: string, issueId: string) =>
    post<{ issueId: string, status: string }>(
      `/api/projects/${projectId}/processes/${issueId}/terminate`,
      {},
    ),

  rawFileUrl: (projectId: string, path: string, root?: string | null) => {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const qs = root ? `?root=${encodeURIComponent(root)}` : ''
    return `/api/projects/${projectId}/files/raw/${encodedPath}${qs}`
  },

  // Webhooks
  getWebhooks: () => get<Webhook[]>('/api/settings/webhooks'),
  createWebhook: (data: {
    channel?: string
    url: string
    secret?: string
    events: WebhookEventType[]
    isActive?: boolean
  }) => post<Webhook>('/api/settings/webhooks', data),
  updateWebhook: (
    id: string,
    data: {
      channel?: string
      url?: string
      secret?: string | null
      events?: WebhookEventType[]
      isActive?: boolean
    },
  ) => patch<Webhook>(`/api/settings/webhooks/${id}`, data),
  deleteWebhook: (id: string) => del<{ id: string }>(`/api/settings/webhooks/${id}`),
  getWebhookDeliveries: (id: string) =>
    get<WebhookDelivery[]>(`/api/settings/webhooks/${id}/deliveries`),
  testWebhook: (id: string) => post<{ sent: boolean }>(`/api/settings/webhooks/${id}/test`, {}),

  // Notes
  getNotes: () => get<Note[]>('/api/notes'),
  createNote: (data: { title?: string, content?: string }) => post<Note>('/api/notes', data),
  updateNote: (id: string, data: { title?: string, content?: string, isPinned?: boolean }) =>
    patch<Note>(`/api/notes/${id}`, data),
  deleteNote: (id: string) => del<{ id: string }>(`/api/notes/${id}`),
}
