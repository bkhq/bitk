type IssueUpdateCallback = (data: { issueId: string; changes: Record<string, unknown> }) => void

const listeners = new Set<IssueUpdateCallback>()

export function onIssueUpdated(cb: IssueUpdateCallback): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function emitIssueUpdated(issueId: string, changes: Record<string, unknown>): void {
  for (const cb of listeners) {
    try {
      cb({ issueId, changes })
    } catch {
      /* ignore */
    }
  }
}
