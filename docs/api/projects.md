# Projects

## GET /api/projects

List all projects. Returns `isGitRepo` flag for each project.

| Query Param | Type | Description |
|---|---|---|
| `archived` | `"true" \| "false"` | Filter by archive status (default: non-archived) |

**Response:** `Project[]` (ordered by `sortOrder` ASC, then `updatedAt` DESC)

## POST /api/projects

Create a new project. Auto-generates alias from name if not provided. Alias is deduplicated with numeric suffix. Directory uniqueness is enforced (returns `409` if already used).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` (1-200) | Yes | Project name |
| `alias` | `string` (1-200) | No | URL-friendly alias (lowercase alphanumeric, regex: `/^[a-z0-9]+$/`) |
| `description` | `string` (0-5000) | No | Project description |
| `directory` | `string` (0-1000) | No | Working directory path (normalized via `path.resolve`) |
| `repositoryUrl` | `string` (URL or empty) | No | Git repository URL |
| `systemPrompt` | `string` (0-32768) | No | Default system prompt for agents |
| `envVars` | `Record<string, string>` | No | Environment variables (max 10000 chars per value) |

**Response:** `201` with `Project`

## GET /api/projects/:projectId

Get a single project by ID or alias. Returns `isGitRepo` flag.

## PATCH /api/projects/:projectId

Update a project. Same fields as POST, all optional. Additional field:

| Field | Type | Description |
|---|---|---|
| `sortOrder` | `string` (1-50) | Fractional sort key (regex: `/^[a-z0-9]+$/i`) |

Directory uniqueness is enforced (returns `409` if already used by another project).

## DELETE /api/projects/:projectId

Soft-delete a project and all its issues (transaction-wrapped). Best-effort terminates active processes (5s timeout per issue) before deletion. Logs and attachments are preserved for potential restore.

## POST /api/projects/:projectId/archive

Archive a project. Idempotent (no-op if already archived).

## POST /api/projects/:projectId/unarchive

Unarchive a project. Idempotent (no-op if already unarchived).

## PATCH /api/projects/sort

Update project sort order.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Project ID |
| `sortOrder` | `string` (1-50) | Yes | Fractional sort key |
