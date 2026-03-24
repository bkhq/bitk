---
name: bkd
description: Operate a BKD kanban board over its REST API. Use when the user wants to create, inspect, update, execute, or monitor BKD projects, issues, logs, processes, engines, or cron jobs from an agent. This skill assumes a reachable BKD server and provides safe BKD-specific execution workflows.
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
4. Check active workload with `/processes` before starting more executions.
5. Move finished work to `review`, not `done`. Use `done` only after human confirmation.

## BKD-Specific Rules

- Treat project and issue operations as soft-delete flows unless the API
  explicitly says otherwise.
- Expect all standard API responses to use `{ success, data }` or
  `{ success, error }`.
- Follow-up messages sent to `todo` or `done` issues are queued for later
  execution.
- Do not try to change the model during an active session.
- When exact payloads, route shapes, or field lists matter, read
  [references/rest-api.md](./references/rest-api.md).

## Common Patterns

### Validate the server

```bash
curl -s "$BKD_URL/health" | jq
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
curl -s "$BKD_URL/processes" | jq '.data.processes'

curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/types/user-message,assistant-message/turn/last" | jq
```

## Reference Files

- [references/rest-api.md](./references/rest-api.md): exact BKD endpoint and
  payload reference, including projects, issues, execution, logs, engines,
  processes, cron jobs, and status conventions.
