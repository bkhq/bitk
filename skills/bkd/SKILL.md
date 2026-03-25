---
name: bkd
description: Operate a BKD kanban board over its REST API. Use when the user wants to manage BKD projects, issue execution workflows, cron jobs, or execution capacity through a reachable BKD server.
---

# BKD

Operate BKD by sending HTTP requests to `$BKD_URL`, which must point at the BKD
API root such as `http://host:port/api`.

## Core Workflow

1. Confirm `$BKD_URL` before making any request. If it is missing, ask for it.
2. Prefer `curl -s` piped to `jq` so results are easy to inspect.
3. For execution work, use the safe BKD flow:
   - Create the issue in `todo`
   - Send details with `follow-up`
   - Move the issue to `working`
4. Check execution capacity with `/processes/capacity` before starting more executions.
5. Move finished work to `review`, not `done`. Use `done` only after human confirmation.

## BKD-Specific Rules

- Treat project and issue operations as soft-delete flows unless the API
  explicitly says otherwise.
- Expect all standard API responses to use `{ success, data }` or
  `{ success, error }`.
- Follow-up messages sent to `todo` or `done` issues are queued for later
  execution.
- Do not use `/execute` as the normal execution trigger. Move the issue to
  `working` instead.
- Use cron as a separate operational feature, not as part of the issue
  execution flow.
- When exact payloads, route shapes, or field lists matter, read
  [references/rest-api.md](./references/rest-api.md).

## Common Patterns

### Validate the server

```bash
curl -s "$BKD_URL/health" | jq
```

### Check available execution slots

```bash
curl -s "$BKD_URL/processes/capacity" | jq
```

### Safe issue execution

```bash
ISSUE=$(curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"short title","statusId":"todo"}')

ISSUE_ID=$(echo "$ISSUE" | jq -r '.data.id')

curl -s -X POST "$BKD_URL/projects/{projectId}/issues/$ISSUE_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"full implementation details"}' | jq

curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/$ISSUE_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

### Monitor an issue

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs?limit=50" | jq
```

### Manage cron jobs

```bash
curl -s "$BKD_URL/cron/actions" | jq
curl -s "$BKD_URL/cron" | jq
```

## Reference Files

- [references/rest-api.md](./references/rest-api.md): exact BKD endpoint and
  payload reference for health checks, capacity checks, projects, issues, logs,
  cron jobs, and status conventions.
