# AUDIT-030 Files API root containment check is prefix-based and bypassable

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/files.ts:16-19`
- `apps/api/src/routes/files.ts:63-68`

## Description

`isInsideRoot()` uses a simple string prefix check:

```ts
return target === root || target.startsWith(`${root}/`)
```

This is not a safe path-boundary check. If `target` is absolute or resolves to a sibling path with the same prefix, it can pass unexpectedly after `path.resolve()` normalization. Example classes:

- `root=/data/project`
- `target=/data/project-evil/file`

The route currently combines this with user-controlled `root`, which makes the impact worse, but the containment helper is independently unsafe and should not be reused elsewhere.

## Fix Direction

Normalize both paths with `realpath()` / `resolve()`, then compare by path segment boundary rather than raw string prefix. Reject absolute request paths before joining if the API is intended to accept only relative descendants.
