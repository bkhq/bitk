# Issue Changes

## GET /api/projects/:projectId/issues/:id/changes

Get git changes summary for an issue.

**Response:**

```json
{
  "success": true,
  "data": {
    "root": "/path/to/repo",
    "gitRepo": true,
    "files": [{ "path": "...", "status": "...", "type": "...", "staged": true, "additions": 5, "deletions": 2 }],
    "additions": 10,
    "deletions": 5
  }
}
```

## GET /api/projects/:projectId/issues/:id/changes/file

Get diff for a specific file.

| Query Param | Type | Description |
|---|---|---|
| `path` | `string` | File path (no leading `-` or `:`) |

**Response:**

```json
{
  "success": true,
  "data": { "path": "...", "patch": "...", "oldText": "...", "newText": "...", "truncated": false, "type": "...", "status": "..." }
}
```
