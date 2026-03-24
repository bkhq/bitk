# Settings

## Workspace

### GET /api/settings/workspace-path

Get workspace root path. Returns user home directory if not configured.

### PATCH /api/settings/workspace-path

Set workspace root path. Validates that the path exists and is a directory.

**Request Body:** `{ path: string (1-1024) }`

## Write Filter Rules

### GET /api/settings/write-filter-rules

Get write filter rules. Returns default rules if none configured.

### PUT /api/settings/write-filter-rules

Replace all write filter rules.

**Request Body:** `{ rules: [{ id: string, type: "tool-name", match: string, enabled: boolean }] }`

### PATCH /api/settings/write-filter-rules/:id

Toggle a single rule's enabled state.

**Request Body:** `{ enabled: boolean }`

Returns `404` if rule ID not found.

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

Set maximum concurrent executions. Applied at runtime immediately.

**Request Body:** `{ value: 1-50 }`

## Server Info

### GET /api/settings/server-info

Get server name and URL.

### PATCH /api/settings/server-info

Set server name and/or URL. Empty strings clear the values.

**Request Body:** `{ name?: string (0-128), url?: string (0-1024) }`

## Slash Commands

### GET /api/settings/slash-commands

Get cached slash commands. If cache is cold, refreshes from DB before responding.

| Query Param | Type | Description |
|---|---|---|
| `engine` | `string` | Engine type (e.g. `claude-code`, `codex`, `acp`, `acp:gemini`) |

## System Info

### GET /api/settings/system-info

Get system information including app version, runtime details, server config, and process info.

**Response:**

```json
{
  "success": true,
  "data": {
    "app": { "version": "...", "commit": "...", "isCompiled": false, "isPackageMode": false, "startedAt": "...", "uptime": 12345 },
    "runtime": { "bun": "...", "platform": "linux", "arch": "x64", "nodeVersion": "..." },
    "server": { "name": "...", "url": "..." },
    "process": { "pid": 12345 }
  }
}
```

## MCP Settings

### GET /api/settings/mcp

Get MCP endpoint configuration. Environment variables (`MCP_ENABLED`, `MCP_API_KEY`) take precedence over DB settings.

**Response:**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "apiKey": "...",
    "envOverride": { "enabled": false, "apiKey": false }
  }
}
```

### PATCH /api/settings/mcp

Update MCP settings. Empty `apiKey` string clears the key.

**Request Body:** `{ enabled?: boolean, apiKey?: string (0-256) }`

## Webhooks

### GET /api/settings/webhooks

List all webhooks (non-deleted). Secrets are masked in the response.

### POST /api/settings/webhooks

Create a webhook.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `channel` | `"webhook" \| "telegram"` | No | Notification channel (default: `webhook`) |
| `url` | `string` | Yes | Webhook URL (must be http/https for webhook channel) or Telegram chat ID |
| `secret` | `string` (0-256) | No | Webhook signing secret or Telegram bot token (required for Telegram) |
| `events` | `string[]` | Yes | Event types to subscribe to |
| `isActive` | `boolean` | No | Active state (default: true) |

**Security:** Webhook URLs are validated against private/internal network hostnames (SSRF protection). Loopback, RFC 1918, link-local, cloud metadata, and IPv6 private addresses are blocked.

**Response:** `201` with `Webhook`

### PATCH /api/settings/webhooks/:id

Update a webhook. Channel is immutable after creation. Masked secret value is treated as "unchanged".

**Request Body:** `{ url?, secret?, events?, isActive? }`

### DELETE /api/settings/webhooks/:id

Soft-delete a webhook.

### GET /api/settings/webhooks/:id/deliveries

Get recent delivery history for a webhook (last 50 entries).

**Response:** `[{ id, webhookId, event, payload, statusCode, response, success, duration, createdAt }]`

### POST /api/settings/webhooks/:id/test

Send a test delivery to a specific webhook with a sample `issue.updated` payload.

## System Logs

### GET /api/settings/system-logs

Tail the application log file. For large files (>512KB), only the tail is read.

| Query Param | Type | Description |
|---|---|---|
| `lines` | `number` | Number of lines to return (1-5000, default: 200) |

**Response:** `{ lines: string[], fileSize: number, totalLines: number }`

### GET /api/settings/system-logs/download

Download the full log file as `bkd.log`.

### POST /api/settings/system-logs/clear

Truncate the log file.

## Recycle Bin

### GET /api/settings/deleted-issues

List all soft-deleted issues with their project names (N+1 query avoided via batch fetch).

**Response:** `[{ id, title, projectId, projectName, statusId, deletedAt }]`

### POST /api/settings/deleted-issues/:id/restore

Restore a soft-deleted issue. Also restores the parent project if it was soft-deleted (transaction-wrapped).

Returns `400` if the parent project no longer exists (hard-deleted).

## Cleanup

### GET /api/settings/cleanup/stats

Get sizes of cleanable data across four categories: orphaned logs, old version files, orphaned worktrees, and soft-deleted issues/projects.

### POST /api/settings/cleanup

Run cleanup for specified targets. Hard-deletes data (irreversible). Runs `VACUUM` after deleting DB records.

**Request Body:** `{ targets: ("logs" | "oldVersions" | "worktrees" | "deletedIssues")[] }`

**Response:** `{ [target]: { cleaned: number } }`

## Upgrade

### GET /api/settings/upgrade/version

Get current version info.

### GET /api/settings/upgrade/enabled

Check if upgrade is enabled.

### PATCH /api/settings/upgrade/enabled

Toggle upgrade on/off.

**Request Body:** `{ enabled: boolean }`

### GET /api/settings/upgrade/check

Check for updates (uses cached result if recent).

### POST /api/settings/upgrade/check

Force-check for updates from GitHub Releases.

### POST /api/settings/upgrade/download

Start downloading an update. Only URLs from `github.com` and `objects.githubusercontent.com` are allowed. Returns `409` if a download is already in progress.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | `string` (GitHub URL) | Yes | Download URL |
| `fileName` | `string` | Yes | File name (must match `bkd-<type>-v<version>` format) |
| `checksumUrl` | `string` (GitHub URL) | No | SHA-256 checksum URL |

### GET /api/settings/upgrade/download/status

Check download progress.

### POST /api/settings/upgrade/restart

Apply downloaded upgrade and restart the server.

### GET /api/settings/upgrade/downloads

List downloaded update files.

### DELETE /api/settings/upgrade/downloads/:fileName

Delete a downloaded update file.
