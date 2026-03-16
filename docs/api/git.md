# Git

## POST /api/git/detect-remote

Detect git remote URL from a directory.

**Request Body:** `{ directory: string (1-1000) }`

**Response:** `{ url, remote }`
