# Issue Execution

All routes are scoped under `/api/projects/:projectId/issues/:id`.

## POST .../execute

Start execution with a new prompt.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `engineType` | `"claude-code" \| "codex" \| "acp" \| "echo"` | Yes | Engine type |
| `prompt` | `string` (1-32768) | Yes | Task prompt |
| `model` | `string` (1-160) | No | Model identifier |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |

**Response:** `{ executionId, issueId, messageId }`

## POST .../follow-up

Send a follow-up message. Accepts `application/json` or `multipart/form-data`.

**Request Body (JSON):**

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` (1-32768) | Yes | Follow-up message |
| `model` | `string` (1-160) | No | Model override |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |
| `busyAction` | `"queue" \| "cancel"` | No | What to do if agent is busy |
| `meta` | `boolean` | No | Meta command flag |
| `displayPrompt` | `string` (0-500) | No | Display-only prompt text |

**Multipart:** same fields + `files[]` for attachments.

**Response:** `{ executionId, issueId, messageId, queued?: true }`

## DELETE .../pending

Recall a pending (queued) message.

| Query Param | Type | Description |
|---|---|---|
| `messageId` | `string` (ULID) | Message ID to recall |

**Response:** `{ id, content, metadata, attachments }`

## POST .../restart

Restart a failed session.

**Response:** `{ executionId, issueId }`

## POST .../cancel

Cancel active execution.

**Response:** `{ issueId, status }`

## POST .../auto-title

Auto-generate a title using AI.

**Response:** `{ executionId, issueId }`

## GET .../slash-commands

Get available slash commands for the issue's engine.

**Response:** `{ commands, agents, plugins }`
