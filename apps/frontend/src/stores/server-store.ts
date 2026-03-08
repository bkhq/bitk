import { create } from 'zustand'

interface ServerStore {
  name: string | null
  url: string | null
  loaded: boolean
  setServerInfo: (name: string | null, url: string | null) => void
}

export const useServerStore = create<ServerStore>((set) => ({
  name: null,
  url: null,
  loaded: false,
  setServerInfo: (name, url) =>
    set({
      name: name?.trim() || null,
      url: url?.trim() || null,
      loaded: true,
    }),
}))

/** Build an external issue URL using server_url (if set) or window.location.origin as fallback. */
export function getIssueUrl(projectId: string, issueId: string): string {
  const { url, loaded } = useServerStore.getState()
  const base = (loaded && url) || window.location.origin
  return `${base.replace(/\/+$/, '')}/projects/${projectId}/issues/${issueId}`
}
