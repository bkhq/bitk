# Frontend High-Privilege Surfaces Audit

## Boundary

This module covers:

- `apps/frontend/src/components/issue-detail/*`
- `apps/frontend/src/components/files/*`
- `apps/frontend/src/components/terminal/*`
- `apps/frontend/src/components/processes/*`
- `apps/frontend/src/components/settings/*`
- `apps/frontend/src/components/AppSettingsDialog.tsx`

## Security Posture

The frontend is mostly a thin client over powerful backend capabilities:

- file browsing and file writes
- terminal sessions
- process inspection and termination
- worktree cleanup
- upgrade and restart controls
- MCP and webhook configuration

Because of that, frontend-only defects are not the main security driver. The dominant risk is whether the backend actually enforces boundaries on the APIs these components call.

## Surface Notes

### `AUDIT-038` High: the MCP API key is rendered in plaintext in the settings UI

Evidence:

- `apps/api/src/routes/settings/general.ts:343-358`
- `apps/frontend/src/components/AppSettingsDialog.tsx:684-708`
- `apps/frontend/src/components/AppSettingsDialog.tsx:778`

Why it matters:

- the backend returns the real MCP bearer token
- the frontend stores it in component state
- the UI renders it directly into a copyable configuration block

Impact:

- any actor with access to the settings page, screenshots, browser extensions, or copied config text can recover the live MCP credential

### Terminal surface

Evidence:

- `apps/frontend/src/components/terminal/TerminalView.tsx:119-149`
- `apps/frontend/src/components/terminal/TerminalView.tsx:197-279`

Notes:

- The terminal UI can create a session, probe session liveness, delete the session, and open a raw websocket.
- A frontend bug here mainly affects stability or session reuse; the real security boundary is the backend terminal route.

### File surface

Evidence:

- `apps/frontend/src/components/files/FileBrowserContent.tsx`
- `apps/frontend/src/lib/kanban-api.ts`

Notes:

- The frontend does not attempt to sandbox access by itself.
- Given `AUDIT-029` and `AUDIT-030`, the file browser is currently only as safe as the backend route implementation.

### Settings surface

Evidence:

- `apps/frontend/src/components/AppSettingsDialog.tsx`
- `apps/frontend/src/components/settings/WebhookSection.tsx`

Notes:

- The settings UI is effectively an administrative control panel.
- Reviewers should treat any route it can reach as a privileged server capability, even if the frontend component itself looks harmless.
- A few destructive cleanup actions still lack the same confirmation pattern already used elsewhere in the dialog, which raises accidental-destruction risk even if it is not the highest-severity finding in this pass.

## Recommended Follow-Up

1. Stop returning raw MCP secrets to the frontend after initial creation.
2. Prioritize backend enforcement for file, terminal, MCP, and upgrade routes.
3. Keep frontend state-management improvements secondary to server-side boundary fixes.
4. After backend fixes land, re-test drawer flows and long-lived websocket/SSE paths for stale-state regressions.
