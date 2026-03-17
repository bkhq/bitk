# Issue Logs

## GET /api/projects/:projectId/issues/:id/logs

Get paginated issue logs (all types).

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
    "logs": [{ "messageId": "...", "entryType": "...", "content": "...", "turnIndex": 0 }],
    "nextCursor": "string | null",
    "hasMore": true
  }
}
```

## GET /api/projects/:projectId/issues/:id/logs/filter/*

Get filtered issue logs. Path segments after `/filter/` are parsed as key/value pairs (order-independent).

### Filter Keys

| Key | Value Format | Description |
|---|---|---|
| `types` | Comma-separated | Filter by entry type |
| `turn` | See below | Filter by turn index |

**Allowed entry types:** `user-message`, `assistant-message`, `tool-use`, `system-message`, `thinking`

**Turn value formats:**

| Format | Example | Description |
|---|---|---|
| Single number | `3` | Specific turn |
| Range | `2-5` | Turns 2 through 5 (inclusive) |
| `last` | `last` | Most recent turn |
| `lastN` | `last3` | Last N turns |

### Examples

```
# Only user and assistant messages
GET .../logs/filter/types/user-message,assistant-message

# Last turn only
GET .../logs/filter/turn/last

# Last 3 turns, tool-use entries only
GET .../logs/filter/turn/last3/types/tool-use

# Turn range with multiple types
GET .../logs/filter/types/user-message,assistant-message/turn/2-5
```

### Query Params

Pagination query params (`cursor`, `before`, `limit`) work the same as the base `/logs` endpoint.

**Response:** Same envelope as `/logs`.
