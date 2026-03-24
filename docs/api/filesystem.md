# Filesystem

All filesystem routes enforce workspace boundary (SEC-022). When a workspace root is configured and is not `/`, all paths are restricted to be within it.

## GET /api/filesystem/dirs

List directories (non-hidden only). Parent directory is clamped to workspace root.

| Query Param | Type | Description |
|---|---|---|
| `path` | `string` | Directory path (defaults to workspace root or CWD) |

**Response:** `{ current, parent, dirs }` where `parent` is `null` at the workspace boundary.

## POST /api/filesystem/dirs

Create a directory. Name is validated as a simple basename (no path traversal: no `/`, `.`, or `..`).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Parent directory path |
| `name` | `string` (1-255) | Yes | Directory name (basename only) |

**Response:** `201` with `{ path }` (absolute path of created directory)
