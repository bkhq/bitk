import type { NormalizedLogEntry } from '@bitk/shared'
import { appEvents } from './index'

export function emitIssueUpdated(
  issueId: string,
  changes: Record<string, unknown>,
): void {
  appEvents.emit('issue-updated', { issueId, changes })
}

export function emitIssueLogUpdated(
  issueId: string,
  entry: NormalizedLogEntry,
): void {
  appEvents.emit('log-updated', { issueId, entry })
}
