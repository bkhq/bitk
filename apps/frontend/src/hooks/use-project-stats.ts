import { STATUSES } from '@/lib/statuses'
import { useIssues } from './use-kanban'

export function useProjectStats(projectId: string) {
  const { data: issues } = useIssues(projectId)

  return {
    issueCount: issues?.length ?? 0,
    statusCount: STATUSES.length,
  }
}
