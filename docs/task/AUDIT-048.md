# AUDIT-048 Cache thundering herd in cacheGetOrSet

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Backend
- **source**: claude-audit/backend-core.md
- **created**: 2026-03-19

## Location

- `apps/api/src/cache.ts`

## Description

Concurrent calls to `cacheGetOrSet` with the same key all execute the fetcher function simultaneously. No deduplication or locking causes redundant expensive operations (DB queries, HTTP probes) when cache is cold or expired. Particularly impactful for startup probe and settings lookups.

## Fix Direction

Add an in-flight request map: if a fetch is already in progress for a key, subsequent callers await the same promise instead of spawning duplicate fetches.
