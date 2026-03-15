# PLAN-024 Issue Read-Only Share via Token

- **Status**: completed
- **Task**: FEAT-004

## Context

Users need to share issue execution results with external systems. Current URLs point to the full editable view. A token-based read-only URL provides a clean, revocable sharing mechanism.

## Design

### DB Changes
- Add `share_token` (text, nullable, unique index) to `issues` table
- Migration: `ALTER TABLE issues ADD COLUMN share_token TEXT`
- Token format: nanoid 12-char alphanumeric

### API Endpoints
- `POST /api/projects/:projectId/issues/:id/share` → generates token, returns `{ shareToken, shareUrl }`
- `DELETE /api/projects/:projectId/issues/:id/share` → clears token
- `GET /api/share/:token` → returns issue data (no auth needed)
- `GET /api/share/:token/logs` → returns logs with pagination (no auth needed)

### Frontend
- Route: `/share/:token` → `SharedIssuePage`
- ChatArea: add `readOnly` prop to hide edit/action controls
- ChatBody: hide ChatInput, delete, cancel when readOnly
- Share button in title bar: generates token + copies URL

## Steps

1. Schema + migration
2. API routes
3. Shared types
4. Frontend page + components
5. i18n
6. Test
