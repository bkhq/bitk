# AUDIT-072 No GitHub API rate limit handling in upgrade checker

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/upgrade/github.ts`

## Description

GitHub API returns 403 when rate-limited but the code treats this as a generic failure without differentiation or backoff. Multi-instance deployments sharing the same IP can hit rate limits frequently.

## Fix Direction

Parse the `X-RateLimit-Remaining` and `Retry-After` headers. Back off when rate-limited instead of retrying at the normal interval.
