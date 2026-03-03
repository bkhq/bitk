import { appEvents } from './index'

export function emitIssueUpdated(
  issueId: string,
  changes: Record<string, unknown>,
): void {
  appEvents.emit('issue-updated', { issueId, changes })
}
