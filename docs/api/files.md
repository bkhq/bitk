# Files

All file routes require the `root` query parameter. Root is validated against workspace root (SEC-007). Symlink traversal is prevented via `realpath()` verification (SEC-008, SEC-009).

## GET /api/files/show

Get directory listing for the root path.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path (required) |
| `hideIgnored` | `"true" \| "false"` | Hide git-ignored files |

**Response (directory):**

```json
{
  "success": true,
  "data": {
    "path": ".",
    "type": "directory",
    "entries": [{ "name": "...", "type": "file|directory", "size": 1234, "modifiedAt": "..." }]
  }
}
```

Entries are sorted: directories first, then alphabetically. The `.git` directory is always excluded.

## GET /api/files/show/*

Get directory listing or file content for a subpath.

**Response (file):**

```json
{
  "success": true,
  "data": {
    "path": "...",
    "type": "file",
    "content": "...",
    "size": 1234,
    "isTruncated": false,
    "isBinary": false
  }
}
```

Max 1 MB file preview. Binary files detected via null-byte check in first 8KB (returns empty `content` with `isBinary: true`).

## GET /api/files/raw/*

Download raw file. Returns file stream with `Content-Disposition: attachment`.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |

Returns `400` if path is not a file. Symlink traversal verified.

## PUT /api/files/save/*

Save text file content. Symlink traversal verified before write.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |

**Request Body:** `{ content: string }` (max 5 MB)

**Response:** `{ size, modifiedAt }`

## DELETE /api/files/delete/*

Delete a file or directory (recursive for directories). Cannot delete the root directory itself. Symlink traversal verified. This is an **irreversible** disk deletion.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |

**Response:** `{ deleted: true }`
