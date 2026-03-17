# Issues

All issue routes are scoped under `/api/projects/:projectId`.

## GET /api/projects/:projectId/issues

List issues for a project.

| Query Param | Type | Description |
|---|---|---|
| `parentId` | `string \| "null"` | Filter by parent issue (use `"null"` for root issues) |

**Response:** `Issue[]` (each includes `childCount`)

## GET /api/projects/:projectId/issues/:id

Get a single issue with its children.

**Response:** `Issue & { children: Issue[] }`

## POST /api/projects/:projectId/issues

Create an issue. Auto-executes if `statusId` is `working` or `review`.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (1-500) | Yes | Issue title |
| `tags` | `string[]` | No | Max 10 tags, 50 chars each |
| `statusId` | `"todo" \| "working" \| "review" \| "done"` | Yes | Initial status |
| `parentIssueId` | `string` | No | Parent issue ID |
| `useWorktree` | `boolean` | No | Run in git worktree |
| `engineType` | `"claude-code" \| "codex" \| "acp" \| "echo"` | No | Engine to use |
| `model` | `string` (1-160) | No | Model identifier |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |

**Response:** `201` (or `202` if auto-executing) with `Issue`

## PATCH /api/projects/:projectId/issues/:id

Update an issue.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (1-500) | No | Issue title |
| `tags` | `string[] \| null` | No | Tags (null to clear) |
| `statusId` | `"todo" \| "working" \| "review" \| "done"` | No | Status (triggers execution/cancellation) |
| `sortOrder` | `string` | No | Fractional sort key |
| `parentIssueId` | `string \| null` | No | Parent issue (null to unparent) |

## PATCH /api/projects/:projectId/issues/bulk

Bulk update issues.

**Request Body:**

```json
{
  "updates": [
    { "id": "string", "statusId?": "todo|working|review|done", "sortOrder?": "string" }
  ]
}
```

Max 1000 items. Status transitions trigger execution/cancellation.

**Response:** `{ data: Issue[], skipped?: string[] }`

## DELETE /api/projects/:projectId/issues/:id

Soft-delete an issue and its children. Terminates active processes.

## GET /api/issues/review

List all issues in `review` status across all projects (global, not project-scoped).

**Response:** `(Issue & { projectName, projectAlias })[]`
