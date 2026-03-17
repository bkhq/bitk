# Issue Logs

## GET /api/projects/:projectId/issues/:id/logs

Get paginated issue logs.

| Query Param | Type | Description |
|---|---|---|
| `cursor` | `string` (ULID) | Cursor for forward pagination |
| `before` | `string` (ULID) | Cursor for backward pagination |
| `limit` | `number` (1-1000) | Page size (default: 30) |

**Response:**

```json
{
  "success": true,
  "data": {
    "issue": "Issue",
    "logs": [{ "messageId": "...", "type": "...", "content": "...", "role": "..." }],
    "nextCursor": "string | null",
    "hasMore": true
  }
}
```
