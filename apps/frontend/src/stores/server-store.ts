import { create } from 'zustand'

interface ServerStore {
  name: string | null
  url: string | null
  setServerInfo: (name: string | null, url: string | null) => void
}

export const useServerStore = create<ServerStore>((set) => ({
  name: null,
  url: null,
  setServerInfo: (name, url) =>
    set({
      name: name?.trim() || null,
      url: url?.trim() || null,
    }),
}))

/** Build an issue URL using the current browser origin. */
export function getIssueUrl(projectId: string, issueId: string): string {
  const base = window.location.origin
  return `${base}/projects/${projectId}/issues/${issueId}`
}
