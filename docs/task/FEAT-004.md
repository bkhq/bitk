# FEAT-004 Issue Read-Only Share via Token

- **Status**: completed
- **Priority**: P1
- **Owner**: claude
- **Plan**: PLAN-024

## Description

Add a shareable read-only URL for issues using random tokens. External systems can view execution results via `/share/:token` without needing project context.

## Scope

- DB schema: `shareToken` field on `issues` table
- API: generate/delete/query share token endpoints
- Frontend: read-only page, share button, ChatArea readOnly mode
- i18n keys for both en/zh
