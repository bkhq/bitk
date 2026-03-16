# Files

## GET /api/files/show

Get directory listing for the root path.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path (required) |
| `hideIgnored` | `"true" \| "false"` | Hide git-ignored files |

**Response:**

```json
{
  "success": true,
  "data": {
    "path": "...",
    "type": "directory",
    "entries": [{ "name": "...", "type": "file|directory", "size": 1234, "modifiedAt": "..." }]
  }
}
```

## GET /api/files/show/*

Get directory listing or file content for a subpath.

**Response (file):**

```json
{
  "success": true,
  "data": { "path": "...", "type": "file", "content": "...", "size": 1234, "isTruncated": false, "isBinary": false }
}
```

Max 1 MB file preview. Binary files detected via null-byte check.

## GET /api/files/raw/*

Download raw file. Returns file stream with `Content-Disposition: attachment`.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |

## PUT /api/files/save/*

Save text file content.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |

**Request Body:** `{ content: string }` (max 5 MB)

**Response:** `{ size, modifiedAt }`

## DELETE /api/files/delete/*

Delete a file or directory.

| Query Param | Type | Description |
|---|---|---|
| `root` | `string` | Root directory path |
