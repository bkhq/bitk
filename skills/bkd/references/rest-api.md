# BKD REST API Reference

Use this file when you need exact BKD endpoint paths, payload shapes, or
response expectations. The main `SKILL.md` should stay short; this file holds
the detailed command reference.

## Setup

Set the API root before using any example:

```bash
BKD_URL="http://your-host:port/api"
```

Standard response envelope:

- Success: `{ "success": true, "data": T }`
- Failure: `{ "success": false, "error": "message" }`

## Projects

### List projects

```bash
curl -s "$BKD_URL/projects" | jq
# With filter: ?archived=true
```

### Get project

```bash
curl -s "$BKD_URL/projects/{projectId}" | jq
```

### Create project

```bash
curl -s -X POST "$BKD_URL/projects" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-project",
    "description": "Optional description",
    "directory": "/path/to/workspace"
  }' | jq
```

### Update project

```bash
curl -s -X PATCH "$BKD_URL/projects/{projectId}" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "new-name",
    "directory": "/new/path",
    "systemPrompt": "You are a helpful assistant.",
    "envVars": {
      "KEY": "value"
    }
  }' | jq
```

### Delete project

```bash
curl -s -X DELETE "$BKD_URL/projects/{projectId}" | jq
```

### Archive and unarchive

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/archive" | jq

curl -s -X POST "$BKD_URL/projects/{projectId}/unarchive" | jq
```

## Issues

All issue routes are project-scoped:

`/api/projects/{projectId}/issues/...`

### List issues

```bash
curl -s "$BKD_URL/projects/{projectId}/issues" | jq
```

### Get issue

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}" | jq
```

### Create issue

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "fix auth bug",
    "statusId": "todo",
    "engineType": "claude-code",
    "model": "claude-sonnet-4-20250514",
    "useWorktree": false,
    "keepAlive": false,
    "tags": ["bug", "auth"]
  }' | jq
```

Fields:

- `title`: string, required
- `statusId`: `todo|working|review|done`, required
- `engineType`: optional
- `model`: optional
- `useWorktree`: optional
- `keepAlive`: optional
- `tags`: optional
- `permissionMode`: optional, `auto|supervised|plan`

Status codes:

- `201`: created
- `202`: created and execution started

### Update issue

```bash
curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/{issueId}" \
  -H 'Content-Type: application/json' \
  -d '{
    "statusId": "working"
  }' | jq
```

Supported fields:

- `title`
- `statusId`
- `tags` with `null` to clear
- `keepAlive`
- `isPinned`
- `sortOrder`

### Bulk update issues

```bash
curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/bulk" \
  -H 'Content-Type: application/json' \
  -d '{
    "updates": [
      {"id": "abc12345", "statusId": "review"},
      {"id": "def67890", "statusId": "done"}
    ]
  }' | jq
```

### Delete issue

```bash
curl -s -X DELETE "$BKD_URL/projects/{projectId}/issues/{issueId}" | jq
```

## Execution Control

### Execute issue

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/execute" \
  -H 'Content-Type: application/json' \
  -d '{
    "engineType": "claude-code",
    "prompt": "Fix the authentication bug in src/auth.ts",
    "model": "claude-sonnet-4-20250514"
  }' | jq
```

Fields:

- `engineType`: required
- `prompt`: required
- `model`: optional
- `permissionMode`: optional

### Follow-up message

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Also fix the logout flow and add tests"
  }' | jq
```

Fields:

- `prompt`: required
- `model`
- `permissionMode`
- `busyAction`: `queue|cancel`
- `meta`
- `displayPrompt`

Behavior by status:

- `todo` and `done`: queued
- `working` during an active turn: queued
- `working` when idle and `review`: immediate follow-up

### Follow-up with files

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/follow-up" \
  -F 'prompt=Analyze this screenshot' \
  -F 'files=@/path/to/screenshot.png' | jq
```

### Restart issue

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/restart" | jq
```

### Cancel execution

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/cancel" | jq
```

## Logs

### Get logs

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs?limit=50" | jq
```

Query params:

- `cursor`
- `before`
- `limit`

Response shape:

- `issue`
- `logs`
- `nextCursor`
- `hasMore`

### Filtered logs

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/types/user-message,assistant-message" | jq

curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/turn/last" | jq

curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/types/assistant-message/turn/last3" | jq

curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/turn/2-5" | jq
```

Filter keys:

- `types/<list>`
- `turn/<value>`

Valid types:

- `user-message`
- `assistant-message`
- `tool-use`
- `system-message`
- `thinking`

## Engines

### List available engines and models

```bash
curl -s "$BKD_URL/engines/available" | jq
```

### Get engine settings

```bash
curl -s "$BKD_URL/engines/settings" | jq
```

### Set default engine

```bash
curl -s -X PATCH "$BKD_URL/engines/default-engine" \
  -H 'Content-Type: application/json' \
  -d '{"defaultEngine": "claude-code"}' | jq
```

### Set default model

```bash
curl -s -X PATCH "$BKD_URL/engines/claude-code/settings" \
  -H 'Content-Type: application/json' \
  -d '{"defaultModel": "claude-sonnet-4-20250514"}' | jq
```

## Processes

### List active processes

```bash
curl -s "$BKD_URL/processes" | jq
```

Response shape:

```json
{
  "success": true,
  "data": {
    "processes": []
  }
}
```

Each process item may include:

- `executionId`
- `issueId`
- `issueTitle`
- `issueNumber`
- `projectId`
- `projectAlias`
- `projectName`
- `engineType`
- `processState`
- `model`
- `startedAt`
- `turnInFlight`
- `spawnCommand`
- `lastIdleAt`
- `pid`

## Cron Jobs

For delete, trigger, pause, and resume operations, `{job}` may be either the job
ID or the job name. For cron log lookup, use the job ID.

### List cron jobs

```bash
curl -s "$BKD_URL/cron" | jq
```

Useful query params:

- `limit`
- `cursor`
- `deleted=false|true|only`

### List cron actions

```bash
curl -s "$BKD_URL/cron/actions" | jq
```

### Create cron job

```bash
curl -s -X POST "$BKD_URL/cron" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "daily-cleanup",
    "cron": "@daily",
    "action": "upload-cleanup",
    "config": {}
  }' | jq
```

Generic fields:

- `name`: string, required
- `cron`: string, required
- `action`: string, required
- `config`: object, optional but commonly used for issue actions

### Issue actions

Use these `action` values for issue-oriented cron jobs:

#### `issue-execute`

Required `config` fields:

- `projectId`
- `issueId`
- `prompt`

Optional `config` fields:

- `engineType`
- `model`

Example:

```bash
curl -s -X POST "$BKD_URL/cron" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "nightly-issue-execute",
    "cron": "@daily",
    "action": "issue-execute",
    "config": {
      "projectId": "my-project",
      "issueId": "abc12345",
      "prompt": "Run the nightly maintenance task and report the result.",
      "engineType": "claude-code"
    }
  }' | jq
```

#### `issue-follow-up`

Required `config` fields:

- `projectId`
- `issueId`
- `prompt`

Optional `config` fields:

- `model`

Example:

```bash
curl -s -X POST "$BKD_URL/cron" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "morning-follow-up",
    "cron": "@hourly",
    "action": "issue-follow-up",
    "config": {
      "projectId": "my-project",
      "issueId": "abc12345",
      "prompt": "Post a status check-in and ask for the next step."
    }
  }' | jq
```

#### `issue-close`

Required `config` fields:

- `projectId`
- `issueId`

Optional `config` fields:

- `targetStatus`: defaults to `done`; valid BKD statuses are `todo`, `working`,
  `review`, and `done`

Example:

```bash
curl -s -X POST "$BKD_URL/cron" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "close-stale-review-item",
    "cron": "@weekly",
    "action": "issue-close",
    "config": {
      "projectId": "my-project",
      "issueId": "abc12345",
      "targetStatus": "done"
    }
  }' | jq
```

#### `issue-check-status`

Required `config` fields:

- `projectId`
- `issueId`

Example:

```bash
curl -s -X POST "$BKD_URL/cron" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "check-issue-status",
    "cron": "@every_minute",
    "action": "issue-check-status",
    "config": {
      "projectId": "my-project",
      "issueId": "abc12345"
    }
  }' | jq
```

### Delete cron job

```bash
curl -s -X DELETE "$BKD_URL/cron/{job}" | jq
```

### Trigger cron job

```bash
curl -s -X POST "$BKD_URL/cron/{job}/trigger" | jq
```

### Pause cron job

```bash
curl -s -X POST "$BKD_URL/cron/{job}/pause" | jq
```

### Resume cron job

```bash
curl -s -X POST "$BKD_URL/cron/{job}/resume" | jq
```

### Get cron job logs

```bash
curl -s "$BKD_URL/cron/{jobId}/logs?limit=20" | jq
```

Supported query params:

- `status=success|failed|running`
- `cursor`
- `limit`

## Other Endpoints

### SSE event stream

```bash
curl -s -N "$BKD_URL/events"
```

### Issue changes

```bash
curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/changes" | jq
```

### Auto-title

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues/{issueId}/auto-title" | jq
```

### Recall pending message

```bash
curl -s -X DELETE "$BKD_URL/projects/{projectId}/issues/{issueId}/pending?messageId={ULID}" | jq
```

## Recommended Operational Workflows

### Safe create and execute

```bash
ISSUE=$(curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"fix auth bug","statusId":"todo"}')

ISSUE_ID=$(echo "$ISSUE" | jq -r '.data.id')

curl -s -X POST "$BKD_URL/projects/{projectId}/issues/$ISSUE_ID/follow-up" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"The login endpoint returns 500 when password contains special chars. Fix src/auth.ts and add tests."}' | jq

curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/$ISSUE_ID" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"working"}' | jq
```

### Quick execute

```bash
curl -s -X POST "$BKD_URL/projects/{projectId}/issues" \
  -H 'Content-Type: application/json' \
  -d '{"title":"bump version to 2.0","statusId":"working"}' | jq
```

### Monitor progress

```bash
curl -s "$BKD_URL/processes" | jq '.data.processes | length'

curl -s "$BKD_URL/projects/{projectId}/issues/{issueId}/logs/filter/types/user-message,assistant-message/turn/last" | jq
```

### Completion

```bash
curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/{issueId}" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"review"}' | jq

curl -s -X PATCH "$BKD_URL/projects/{projectId}/issues/{issueId}" \
  -H 'Content-Type: application/json' \
  -d '{"statusId":"done"}' | jq
```

## Status Conventions

Board statuses:

- `todo`
- `working`
- `review`
- `done`

Session statuses:

- `pending`
- `running`
- `completed`
- `failed`
- `cancelled`
