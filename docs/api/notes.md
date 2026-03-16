# Notes

## GET /api/notes

List all notes.

## POST /api/notes

Create a note.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (0-500) | No | Note title |
| `content` | `string` (0-100000) | No | Note content |

**Response:** `201` with `Note`

## PATCH /api/notes/:id

Update a note.

**Request Body:** `{ title?, content?, isPinned?: boolean }`

## DELETE /api/notes/:id

Soft-delete a note.
