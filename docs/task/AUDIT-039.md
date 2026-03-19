# AUDIT-039 useIssueStream can drop later log updates after live-log trimming

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Frontend
- **created**: 2026-03-19

## Location

- `apps/frontend/src/hooks/use-issue-stream.ts:130-180`
- `apps/frontend/src/hooks/use-issue-stream.ts:186-217`
- `apps/frontend/src/lib/event-bus.ts:66-76`

## Description

When `liveLogs` exceeds 500 entries, the hook trims old entries but does not remove their `messageId`s from `seenIdsRef`. If a later SSE `log-updated` event arrives for one of those trimmed entries, the update path falls back to append logic and gets rejected by `isSeen()`.

The UI can therefore keep showing stale content for long-running sessions after the trimmed message is updated on the server.

## Fix Direction

When trimming entries out of the live window, also evict their IDs from the dedup set or rework the dedup logic so updates for trimmed entries can be reinserted safely.
