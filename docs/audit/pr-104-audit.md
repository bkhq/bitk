# PR-104 Audit

**Date:** 2026-03-24  
**PR:** `https://github.com/bkhq/bkd/pull/104`  
**Scope:** full branch diff `origin/main...feat/openapi-auto-generation`  
**Methodology:** static review of changed files plus local regeneration of the OpenAPI document for drift checking

## Summary

The branch bundles more than one concern: route migration to `OpenAPIHono`, static OpenAPI export generation, cron API expansion, test executor replacement, and skill-package reference updates. The highest-risk problems are concentrated in the OpenAPI migration path, where request validation became less strict and the published API references no longer match the live router consistently.

## Findings

### 1. High — `engineType` validation regressed from a constrained enum-like check to arbitrary strings

The legacy issue schemas in `apps/api/src/routes/issues/_shared.ts` still validate `engineType` against `claude-code`, `codex`, `acp`, or `acp:*`, but the new OpenAPI-backed schemas in `apps/api/src/openapi/schemas.ts` use plain `z.string()` for both create and execute flows.

Affected handlers then trust the validated body and propagate the value directly:

- `apps/api/src/routes/issues/create.ts` stores `body.engineType` on the issue row
- `apps/api/src/routes/issues/command.ts` casts `body.engineType` to `EngineType` and passes it into `issueEngine.executeIssue()`

Impact:

- invalid engine names can now be persisted on issues
- a request that previously should have failed with `400` can instead fail later during execution
- downstream logic now has to defend against malformed engine identifiers that the API layer used to block

### 2. Medium — OpenAPI `servers` configuration duplicates the `/api` prefix already present in generated paths

Both the live docs route and the static generation script publish `servers: [{ url: "/api" }]`, while the generated document paths are already rooted at `/api/...`.

Examples:

- runtime docs setup in `apps/api/src/app.ts`
- static generation in `scripts/gen-openapi.ts`
- generated paths in `skills/bkd/references/openapi.json`

Impact:

- Swagger UI "Try it out" requests resolve to `/api/api/...`
- generated clients that honor `servers` will call incorrect endpoints
- the published contract is broken even if the underlying route handlers work

### 3. Medium — Documented route catalog is not fully wired into the live OpenAPI router

`apps/api/src/openapi/routes.ts` defines `followUpIssue` and `getEventStream`, but the actual handlers are still registered with plain `.post()` / `.get()` calls instead of `router.openapi(...)`.

Examples:

- `apps/api/src/routes/issues/message.ts` keeps the follow-up endpoint as `message.post('/:id/follow-up', ...)`
- `apps/api/src/routes/events.ts` keeps the SSE endpoint as `events.get('/', ...)`

Impact:

- those endpoints are absent from the live OpenAPI document
- the route catalog is no longer a reliable source of truth by itself
- follow-up is especially important because it is a core issue lifecycle action

### 4. Medium — The committed static OpenAPI artifact already drifted from the current live router output

A fresh local run of `bun scripts/gen-openapi.ts --output /tmp/pr104-openapi.json` produced a diff against the committed `skills/bkd/references/openapi.json`.

One concrete example is `cancelIssue`:

- route definition and handler return `{ issueId, status }`
- committed static spec still documents `{ issueId, cancelled }`

Impact:

- the skill-package reference cannot be trusted as an exact contract
- downstream automation that consumes the static file may generate incorrect request/response expectations
- review confidence drops because "generated" artifacts are no longer reproducible from the checked-in route tree

### 5. Low to Medium — `server-info` response schema is stricter than the actual handler contract

`getServerName()` and `getServerUrl()` return `string | null`, and the handler in `apps/api/src/routes/settings/general.ts` forwards those values directly. However, the OpenAPI response schema in `apps/api/src/openapi/routes.ts` declares both `name` and `url` as required strings.

Impact:

- generated client types overstate the guarantee
- API consumers can receive `null` values that are undocumented
- this increases friction for any consumer relying on the published schema rather than the implementation

## Verification Notes

- Reviewed the full PR diff rather than a single commit
- Cross-checked the current checked-in OpenAPI artifact against a freshly generated document from the branch
- Did not run the full repository test suite for this documentation-only task

## Recommended Follow-up

1. Restore the lost `engineType` validation semantics in the OpenAPI schemas
2. Fix `servers` so it matches the path style used by the generated document
3. Register all intended documented routes through `router.openapi(...)` or remove dead catalog entries
4. Re-generate and commit the static OpenAPI artifact only after the live document is correct
5. Align nullable response shapes such as `server-info` with the published schema
