# AUDIT-038 MCP API key is returned to the frontend and rendered in plaintext

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **created**: 2026-03-19

## Location

- `apps/api/src/routes/settings/general.ts:343-358`
- `apps/frontend/src/components/AppSettingsDialog.tsx:684-708`
- `apps/frontend/src/components/AppSettingsDialog.tsx:778`

## Description

The settings API returns the real MCP API key to the frontend, and the settings UI interpolates it directly into a rendered configuration snippet containing `Authorization: Bearer <key>`.

This exposes the credential to browser state, the DOM, copy-to-clipboard flows, screenshots, and any extension or actor that can inspect the settings page.

## Fix Direction

Do not return the raw secret after creation. Return only masked metadata and provide explicit secret rotation/regeneration flows when the user needs a new token.
