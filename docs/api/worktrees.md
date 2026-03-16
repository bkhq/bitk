# Worktrees

## GET /api/projects/:projectId/worktrees

List git worktrees for a project.

**Response:** `[{ issueId, path, branch }]`

## DELETE /api/projects/:projectId/worktrees/:issueId

Force-delete a worktree. Validates `issueId` against `/^[\w-]{4,32}$/`.
