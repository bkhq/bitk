# Worktrees

## GET /api/projects/:projectId/worktrees

List git worktrees for a project. Reads worktree directories from disk and extracts branch info from git HEAD.

**Response:** `[{ issueId, path, branch }]`

## DELETE /api/projects/:projectId/worktrees/:issueId

Force-delete a worktree. Validates `issueId` against `/^[\w-]{4,32}$/` to prevent path traversal. Resolved path is verified to stay within the project worktree directory. This is an **irreversible** disk deletion.

**Response:** `{ issueId }`
