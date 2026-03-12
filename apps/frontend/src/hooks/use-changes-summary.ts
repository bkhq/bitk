import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ChangesSummaryData } from '@/lib/event-bus'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys } from './use-kanban'

/**
 * Returns `{ fileCount, additions, deletions }` for an issue's git changes.
 *
 * Two data sources, layered:
 * 1. REST `/changes` endpoint (React Query) — authoritative, full detail
 * 2. SSE `changes-summary` events — used as an optimistic preview only until
 *    the REST query re-fetches in response to the invalidation
 *
 * SSE data is cleared once the REST query completes its re-fetch, so REST
 * always wins after the round-trip.
 */
export function useChangesSummary(projectId: string | undefined, issueId: string | undefined) {
  const queryClient = useQueryClient()

  // Initial fetch from REST endpoint — derive summary from full response
  const { data: restData, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.issueChanges(projectId ?? '', issueId ?? ''),
    queryFn: () => kanbanApi.getIssueChanges(projectId!, issueId!),
    enabled: !!projectId && !!issueId,
  })

  // SSE overlay — optimistic preview until REST re-fetches
  const [sseSummary, setSseSummary] = useState<ChangesSummaryData | null>(null)
  // Track when the SSE event arrived so we can clear it once REST catches up
  const sseReceivedAt = useRef<number>(0)

  // Clear SSE overlay once REST data has been updated after the SSE event
  useEffect(() => {
    if (sseSummary && dataUpdatedAt > sseReceivedAt.current) {
      setSseSummary(null)
    }
  }, [sseSummary, dataUpdatedAt])

  useEffect(() => {
    if (!issueId) {
      setSseSummary(null)
      return
    }

    // Reset SSE overlay on issue change
    setSseSummary(null)

    const unsub = eventBus.onChangesSummary((data) => {
      if (data.issueId === issueId) {
        sseReceivedAt.current = Date.now()
        setSseSummary(data)
        // Invalidate REST query so it re-fetches the authoritative data
        if (projectId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.issueChanges(projectId, issueId),
          })
        }
      }
    })

    return unsub
  }, [issueId, projectId, queryClient])

  // Derive summary from REST response
  const restSummary = restData
    ? {
        issueId: issueId ?? '',
        fileCount: restData.files.length,
        additions: restData.additions,
        deletions: restData.deletions,
        root: restData.root,
      }
    : null

  // SSE data is used as optimistic preview; preserve REST root
  if (sseSummary) {
    return {
      ...sseSummary,
      root: restSummary?.root,
    }
  }

  return restSummary
}
