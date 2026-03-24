# Notes

All note operations include error handling with `500` responses on failure.

## GET /api/notes

List all notes (non-deleted). Ordered by `isPinned` DESC, then `updatedAt` DESC.

## POST /api/notes

Create a note.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (0-500) | No | Note title (defaults to empty) |
| `content` | `string` (0-100000) | No | Note content (defaults to empty) |

**Response:** `201` with `Note`

## PATCH /api/notes/:id

Update a note.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (0-500) | No | Note title |
| `content` | `string` (0-100000) | No | Note content |
| `isPinned` | `boolean` | No | Pin status |

## DELETE /api/notes/:id

Soft-delete a note.
