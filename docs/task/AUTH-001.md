# AUTH-001 OAuth PKCE Authentication

- **status**: completed
- **priority**: P0
- **owner**: claude
- **plan**: PLAN-028
- **created**: 2026-03-19
- **updated**: 2026-03-19

## Description

Implement OAuth PKCE (Authorization Code with Proof Key for Code Exchange) authentication for BKD. No local user storage — rely entirely on the remote OAuth provider for identity. Access control via username whitelist via `AUTH_ALLOWED_USERS` env var. Auth can be disabled entirely via `AUTH_ENABLED` env var. All config is env-var-only, no database or settings UI.

## Requirements

1. Support OAuth 2.0 Authorization Code + PKCE flow
2. No local user table — all config via env vars
3. Username whitelist via `AUTH_ALLOWED_USERS` env var
4. Auth can be disabled entirely (env var)
5. Protect all API routes, SSE, and WebSocket when auth is enabled
6. Frontend: redirect to OAuth login when unauthenticated, store token in localStorage

## Acceptance Criteria

- [x] OAuth PKCE flow works end-to-end (login → callback → authenticated session)
- [x] Unauthenticated requests return 401 when auth is enabled
- [x] Username whitelist enforced after successful OAuth login
- [x] Auth can be toggled off (all requests pass through)
- [x] SSE and WebSocket connections are authenticated (token query param)
- [x] Frontend shows login page when unauthenticated
- [x] No settings UI — all config via env vars

## Implementation

### Backend (`apps/api/src/auth/`)
- `types.ts` — AuthUser, OIDCDiscoveryDoc, AuthConfig, TokenPayload
- `config.ts` — Parse all auth env vars, validate at startup
- `oidc.ts` — OIDC Discovery + token exchange + userinfo fetch
- `jwt.ts` — HMAC-SHA256 sign/verify using AUTH_SECRET
- `middleware.ts` — Hono middleware: Bearer header + token query param fallback
- `routes.ts` — `/api/auth/config`, `/api/auth/token`, `/api/auth/me`, `/api/auth/logout`

### Frontend
- `lib/auth.ts` — Token storage (localStorage), PKCE helpers
- `pages/LoginPage.tsx` — Generate PKCE, redirect to OIDC authorize
- `pages/LoginCallbackPage.tsx` — Exchange code, store JWT
- `hooks/use-auth.ts` — Auth state hook
- `main.tsx` — AuthGate wrapping all protected routes
- `lib/kanban-api.ts` — Bearer token injection + 401 redirect
- `lib/event-bus.ts` — Token in SSE query param
- `components/terminal/TerminalView.tsx` — Token in WS query param

### Resolves
- AUDIT-034: Privileged API surfaces now have auth middleware
