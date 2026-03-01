import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ChangesSummaryData } from '@/lib/event-bus'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys } from './use-kanban'

/**
 * Returns `{ fileCount, additions, deletions }` for an issue's git changes.
 *
 * Two data sources, layered:
 * 1. Initial fetch via REST `/changes` endpoint (React Query, staleTime 30s)
 * 2. SSE `changes-summary` events override the REST data in real-time
 */
export function useChangesSummary(
  projectId: string | undefined,
  issueId: string | undefined,
) {
  const queryClient = useQueryClient()

  // Initial fetch from REST endpoint — derive summary from full response
  const { data: restData } = useQuery({
    queryKey: queryKeys.issueChanges(projectId ?? '', issueId ?? ''),
    queryFn: () => kanbanApi.getIssueChanges(projectId!, issueId!),
    enabled: !!projectId && !!issueId,
  })

  // SSE overlay — real-time updates override REST data
  const [sseSummary, setSseSummary] = useState<ChangesSummaryData | null>(null)

  useEffect(() => {
    if (!issueId) {
      setSseSummary(null)
      return
    }

    // Reset SSE overlay on issue change
    setSseSummary(null)

    const unsub = eventBus.onChangesSummary((data) => {
      if (data.issueId === issueId) {
        setSseSummary(data)
        // Also invalidate the REST query so DiffPanel picks up new data
        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.issueChanges(projectId, issueId),
          })
        }
      }
    })

    return unsub
  }, [issueId, projectId, queryClient])

  // SSE data takes priority over REST data
  if (sseSummary) return sseSummary

  // Derive summary from REST response
  if (restData) {
    return {
      issueId: issueId ?? '',
      fileCount: restData.files.length,
      additions: restData.additions,
      deletions: restData.deletions,
    } satisfies ChangesSummaryData
  }

  return null
}
