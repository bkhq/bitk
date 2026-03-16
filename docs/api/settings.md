# Settings

## Workspace

### GET /api/settings/workspace-path

Get workspace root path.

### PATCH /api/settings/workspace-path

Set workspace root path.

**Request Body:** `{ path: string (1-1024) }`

## Write Filter Rules

### GET /api/settings/write-filter-rules

Get write filter rules.

### PUT /api/settings/write-filter-rules

Replace all write filter rules.

**Request Body:** `{ rules: [{ id, type: "tool-name", match, enabled }] }`

### PATCH /api/settings/write-filter-rules/:id

Toggle a single rule.

**Request Body:** `{ enabled: boolean }`

## Worktree Cleanup

### GET /api/settings/worktree-auto-cleanup

Get worktree auto-cleanup setting.

### PATCH /api/settings/worktree-auto-cleanup

Set worktree auto-cleanup.

**Request Body:** `{ enabled: boolean }`

## Log Page Size

### GET /api/settings/log-page-size

Get log pagination page size.

### PATCH /api/settings/log-page-size

Set log pagination page size.

**Request Body:** `{ size: 5-200 }`

## Concurrency

### GET /api/settings/max-concurrent-executions

Get maximum concurrent executions.

### PATCH /api/settings/max-concurrent-executions

Set maximum concurrent executions.

**Request Body:** `{ value: 1-50 }`

## Server Info

### GET /api/settings/server-info

Get server name and URL.

### PATCH /api/settings/server-info

Set server name and URL.

**Request Body:** `{ name?: string (0-128), url?: string (0-1024) }`

## Slash Commands

### GET /api/settings/slash-commands

Get cached slash commands.

| Query Param | Type | Description |
|---|---|---|
| `engine` | `string` | Engine type |

## System Info

### GET /api/settings/system-info

Get system information (version, runtime, platform, process PID).
