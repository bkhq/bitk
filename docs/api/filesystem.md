# Filesystem

All filesystem routes enforce workspace boundary (SEC-022).

## GET /api/filesystem/dirs

List directories.

| Query Param | Type | Description |
|---|---|---|
| `path` | `string` | Directory path (defaults to workspace root) |

**Response:** `{ current, parent, dirs }`

## POST /api/filesystem/dirs

Create a directory.

**Request Body:** `{ path: string, name: string (1-255) }`

Name is validated as a basename (no path traversal).

**Response:** `201` with `{ path }`
