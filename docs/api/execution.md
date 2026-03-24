# Issue Execution

All routes are scoped under `/api/projects/:projectId/issues/:id`.

## POST .../execute

Start execution with a new prompt. Validates working directory against workspace root (SEC-016, returns `403` if outside workspace). Automatically moves `review` issues to `working`; rejects `todo` and `done` issues.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `engineType` | `string` | Yes | Engine type (e.g. `claude-code`, `codex`, `acp`, `acp:gemini`) |
| `prompt` | `string` (1-32768) | Yes | Task prompt |
| `model` | `string` (regex: `/^[\w./:\-[\]]{1,160}$/`) | No | Model identifier |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |

**Response:** `{ executionId, issueId, messageId }`

## POST .../follow-up

Send a follow-up message. Accepts `application/json` or `multipart/form-data`.

**Queuing behavior:**
- `todo`/`done` issues: message is queued as pending, processed when issue starts executing
- `working` (turn in flight): message is queued until current turn finishes
- `working` (existing pending messages): message is queued behind existing pending messages
- `working` (idle) or `review`: triggers immediate follow-up
- If follow-up fails, message is saved as pending (not lost)

**Model change restriction:** Cannot change model while session is `running` or `pending` (returns `409`).

**Request Body (JSON):**

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` (1-32768) | Yes | Follow-up message |
| `model` | `string` (regex: `/^[\w./:\-[\]]{1,160}$/`) | No | Model override |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |
| `busyAction` | `"queue" \| "cancel"` | No | What to do if agent is busy |
| `meta` | `boolean` | No | Meta/system command flag |
| `displayPrompt` | `string` (0-500) | No | Display-only prompt text (shown in UI instead of full prompt) |

**Multipart:** same fields + `files[]` for attachments. File validation applied.

**Response:** `{ executionId, issueId, messageId, queued?: true }`

## DELETE .../pending

Recall a pending (queued) message. Emits `log-removed` SSE event.

| Query Param | Type | Description |
|---|---|---|
| `messageId` | `string` (ULID, 26 uppercase alphanumeric chars) | Message ID to recall |

**Response:** `{ id, content, metadata, attachments }`

Returns `404` if no matching pending message found.

## POST .../restart

Restart a failed session. Moves `review` to `working` automatically; rejects `todo` and `done`.

**Response:** `{ executionId, issueId }`

## POST .../cancel

Cancel active execution.

**Response:** `{ issueId, status }`

## POST .../auto-title

Auto-generate a title using AI. Sends a system-level follow-up with the auto-title prompt. Moves `review` to `working` automatically; rejects `todo` and `done`.

**Response:** `{ executionId, issueId }`

## GET .../slash-commands

Get available slash commands for the issue's engine type.

**Response:** `{ commands, agents, plugins }` where `plugins` contains `[{ name, ... }]`.
