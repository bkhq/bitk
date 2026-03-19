# AUDIT-058 Cache returns null for legitimate falsy cached values

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Backend
- **source**: claude-audit/backend-core.md
- **created**: 2026-03-19

## Location

- `apps/api/src/cache.ts`

## Description

`cacheGet` uses `value ?? null`, treating cached `null`/`undefined`/`false`/`0` as cache misses. `cacheGetOrSet` re-fetches for these values on every call, defeating the cache purpose.

## Fix Direction

Use a sentinel value or check `Map.has()` to distinguish "key not cached" from "key cached with falsy value".
