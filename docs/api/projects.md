# Projects

## GET /api/projects

List all projects.

| Query Param | Type | Description |
|---|---|---|
| `archived` | `"true" \| "false"` | Filter by archive status |

**Response:** `Project[]`

## POST /api/projects

Create a new project.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` (1-200) | Yes | Project name |
| `alias` | `string` (1-200) | No | URL-friendly alias (lowercase alphanumeric) |
| `description` | `string` (0-5000) | No | Project description |
| `directory` | `string` (0-1000) | No | Working directory path |
| `repositoryUrl` | `string` (URL) | No | Git repository URL |
| `systemPrompt` | `string` (0-32768) | No | Default system prompt for agents |
| `envVars` | `Record<string, string>` | No | Environment variables (max 10000 chars per value) |

**Response:** `201` with `Project`

## GET /api/projects/:projectId

Get a single project by ID.

## PATCH /api/projects/:projectId

Update a project. Same fields as POST, all optional.

## DELETE /api/projects/:projectId

Soft-delete a project and all its issues. Terminates active processes.

## POST /api/projects/:projectId/archive

Archive a project.

## POST /api/projects/:projectId/unarchive

Unarchive a project.

## PATCH /api/projects/sort

Update project sort order.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Project ID |
| `sortOrder` | `string` (1-50) | Yes | Fractional sort key |
