# Git

## POST /api/git/detect-remote

Detect git remote URL from a directory. Prefers `origin` remote, falls back to first available remote. SSH URLs are normalized to HTTPS format (e.g. `git@github.com:org/repo.git` becomes `https://github.com/org/repo`).

**Security:** Directory is validated to be within the configured workspace root (SEC-030). Returns `403` if outside workspace.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `directory` | `string` (1-1000) | Yes | Directory path to inspect |

**Response:** `{ url, remote }`

**Error responses:**
- `400` `not_a_directory` — path exists but is not a directory
- `400` `not_a_git_repo` — directory is not inside a git work tree
- `403` — directory is outside the configured workspace
- `404` `directory_not_found` — path does not exist
- `404` `no_remote_found` — git repo has no configured remotes
