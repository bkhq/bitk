# PLAN-028 OAuth PKCE Authentication

- **task**: AUTH-001
- **status**: completed
- **owner**: claude
- **created**: 2026-03-19

## Context (Investigation Findings)

### Current State

1. **No auth middleware exists** — `API_SECRET` env var is mentioned in `.env.example` but never enforced in any route or middleware
2. **Frontend API client** (`kanban-api.ts`) — plain `fetch()` with no auth headers; central `request()` function makes adding Bearer token injection trivial
3. **SSE** (`eventBus`) — connects immediately on startup via `EventSource` to `/api/events`, no auth
4. **WebSocket** (`/api/terminal/ws`) — Bun.serve websocket, no auth check
5. **Middleware chain** in `app.ts`: `secureHeaders → compress → httpLogger → routes` — auth middleware slots in after httpLogger, before routes
6. **No user/session tables** — schema has no user-related tables, aligned with the "no local user storage" requirement

### OIDC PKCE Flow Overview

```
Browser                           BKD Server                    OIDC Provider
  │                                   │                              │
  │                                   │── GET /.well-known/oidc ────>│  (startup: discover endpoints)
  │                                   │<── { authorize, token, ... } │
  │                                   │                              │
  │── GET / (no token in LS) ────────>│                              │
  │<── 200 (app loads) ──────────────│                              │
  │   (frontend: no token in LS)      │                              │
  │── redirect to /login ────────────>│                              │
  │   (LoginPage generates PKCE       │                              │
  │    stores verifier in sessionStorage                             │
  │    redirects to authorize URL)    │                              │
  │── GET /authorize?code_challenge..│──────────────────────────────>│
  │   (user authenticates)           │                              │
  │<── 302 /login/callback?code=xxx──│<─────────────────────────────│
  │   (CallbackPage)                  │                              │
  │── POST /api/auth/token ─────────>│                              │
  │   { code, code_verifier, redirect}│── POST /token (code+verifier)>│
  │                                   │<── { access_token, id_token }│
  │                                   │── GET /userinfo ────────────>│
  │                                   │<── { username, email } ──────│
  │                                   │ check whitelist               │
  │                                   │ sign session JWT              │
  │<── { token: "ey...", user: {...} }│                              │
  │   (store token in localStorage)   │                              │
  │── subsequent requests             │                              │
  │   Authorization: Bearer ey...     │                              │
```

### Key Design Decisions

1. **OIDC Discovery**: Only `AUTH_ISSUER` URL needed — server fetches `/.well-known/openid-configuration` at startup to discover authorize/token/userinfo/jwks endpoints. No manual URL config.
2. **PKCE in frontend**: code_verifier generated and stored in `sessionStorage` by the frontend (LoginPage). Server never sees the verifier until the token exchange.
3. **Token in localStorage**: Frontend stores the BKD session JWT in `localStorage`. API requests use `Authorization: Bearer <token>` header.
4. **No local user table**: Server-signed JWT payload contains `{ sub, username, email, exp }` from OIDC provider. No DB writes for users.
5. **Whitelist**: `AUTH_ALLOWED_USERS` env var only (comma-separated). Operator-controlled, not in DB.
6. **Auth toggle**: `AUTH_ENABLED` env var (default: `false`). All auth config via env vars only.

## Proposal

### Architecture

```
apps/api/src/
├── auth/
│   ├── middleware.ts      # Hono middleware: extract Bearer token → verify JWT → set c.var.user
│   ├── routes.ts          # /api/auth/token, /api/auth/me, /api/auth/config
│   ├── jwt.ts             # sign/verify JWT using HMAC-SHA256 (AUTH_SECRET env)
│   ├── oidc.ts            # OIDC Discovery + token exchange + userinfo fetch
│   ├── config.ts          # Read auth config from env vars, validate at startup
│   └── types.ts           # AuthUser, OAuthConfig, OIDCDiscovery types
apps/frontend/src/
├── pages/
│   ├── LoginPage.tsx      # Generate PKCE, redirect to OIDC authorize
│   └── LoginCallbackPage.tsx  # Exchange code, store token in localStorage
├── hooks/
│   └── use-auth.ts        # Auth state from localStorage + /api/auth/me validation
├── lib/
│   └── auth.ts            # Token storage helpers (get/set/clear in localStorage)
```

### Backend Changes

#### 1. Auth Config (`auth/config.ts`)

All auth config is env-var-only — no DB storage, no settings UI.

| Env Var | Required | Description | Example |
|---------|----------|-------------|---------|
| `AUTH_ENABLED` | No | Master toggle (default: `false`) | `"true"` |
| `AUTH_ISSUER` | When enabled | OIDC issuer URL (used for discovery) | `"https://github.com"`, `"https://accounts.google.com"` |
| `AUTH_CLIENT_ID` | When enabled | OAuth client ID | `"abc123"` |
| `AUTH_CLIENT_SECRET` | When enabled | OAuth client secret | `"s3cret"` |
| `AUTH_ALLOWED_USERS` | When enabled | Comma-separated username whitelist | `"alice,bob"` |
| `AUTH_SECRET` | No | HMAC key for JWT signing (auto-generated if missing) | `"random-32-bytes"` |
| `AUTH_PKCE` | No | Enable PKCE (default: `"true"`) | `"true"` / `"false"` |
| `AUTH_SCOPES` | No | OAuth scopes override (default: `"openid profile email"`) | `"openid email"` |
| `AUTH_USERNAME_FIELD` | No | Field in userinfo for whitelist matching (default: auto-detect) | `"login"`, `"email"`, `"preferred_username"` |
| `AUTH_SESSION_TTL` | No | JWT expiry in seconds (default: 604800 = 7 days) | `"86400"` |

**OIDC Discovery** auto-fetches from `{AUTH_ISSUER}/.well-known/openid-configuration`:
- `authorization_endpoint`
- `token_endpoint`
- `userinfo_endpoint`
- `jwks_uri` (for optional id_token validation)

Discovery result is cached in memory (refreshed every 24h).

**Username field auto-detection** by issuer domain:
- `github.com` → `login`
- `accounts.google.com` → `email`
- `gitlab.com` → `username`
- Others → `preferred_username` (OIDC standard claim) → `email` fallback

**Startup validation**: When `AUTH_ENABLED=true`, server refuses to start if:
- `AUTH_ISSUER` is missing
- `AUTH_CLIENT_ID` is missing
- `AUTH_CLIENT_SECRET` is missing
- `AUTH_ALLOWED_USERS` is empty
- OIDC discovery fetch fails

#### 2. Auth Middleware (`auth/middleware.ts`)

```typescript
export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Auth disabled → pass through
    if (!authConfig.enabled) {
      return next()
    }

    // Skip auth routes themselves
    if (c.req.path.startsWith('/api/auth/')) {
      return next()
    }

    // Extract Bearer token from Authorization header
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    // Verify server-signed JWT
    const user = verifyToken(token)
    if (!user) {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401)
    }

    // Set user in context
    c.set('user', user)
    return next()
  }
}
```

Inserted in `app.ts` after `httpLogger()`, before all route mounts. Static file serving (SPA) is NOT behind auth — the frontend loads freely, then handles auth client-side.

#### 3. Auth Routes (`auth/routes.ts`)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/config` | GET | Public. Returns `{ enabled, issuer, clientId, authorizeUrl, scopes }` — no secrets. Frontend uses this to build PKCE authorize URL. |
| `/api/auth/token` | POST | Exchange authorization code for session. Body: `{ code, codeVerifier, redirectUri }`. Server exchanges with OIDC provider, fetches userinfo, checks whitelist, returns signed JWT. |
| `/api/auth/me` | GET | Validate Bearer token, return user info `{ username, email }` |
| `/api/auth/logout` | POST | No-op server-side (stateless JWT). Frontend clears localStorage. |

#### 4. JWT (`auth/jwt.ts`)

- Sign: HMAC-SHA256 using `AUTH_SECRET` env var (auto-generated on first run if not set)
- Payload: `{ sub, username, email, iat, exp }`
- Expiry: 7 days default (configurable via `AUTH_SESSION_TTL`)
- Use Bun's native `crypto` for HMAC (no external dependency)

#### 5. OIDC (`auth/oidc.ts`)

- `discoverOIDC(issuer)` → fetch + cache `/.well-known/openid-configuration`
- `exchangeCode(config, code, codeVerifier, redirectUri)` → POST to token endpoint → `{ access_token, id_token }`
- `fetchUserInfo(config, accessToken)` → GET userinfo endpoint → `{ sub, username, email, ... }`

#### 6. WebSocket Auth

Terminal WebSocket at `/api/terminal/ws`:
- Accept `token` query parameter: `/api/terminal/ws?token=ey...`
- Verify JWT before upgrading connection
- (`EventSource` does not support custom headers, so SSE also needs query param — see below)

#### 7. SSE Auth

`EventSource` API does not support `Authorization` header. Two options:
- **Query param**: `/api/events?token=ey...` — middleware also checks query param as fallback
- Frontend passes token when creating `EventSource`

### Frontend Changes

#### 1. Token Storage (`lib/auth.ts`)

```typescript
const TOKEN_KEY = 'bkd_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}
```

#### 2. API Client Updates (`kanban-api.ts`)

Inject Bearer token into the central `request()` function:

```typescript
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(url, { headers, ...options })

  // 401 → redirect to login
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  const json = (await res.json()) as ApiResponse<T>
  if (!json.success) throw new Error(json.error)
  return json.data
}
```

#### 3. LoginPage (`pages/LoginPage.tsx`)

1. Fetch `GET /api/auth/config` to get `authorizeUrl`, `clientId`, `scopes`
2. Generate PKCE: `codeVerifier` (random 128 chars) + `codeChallenge` (SHA-256 + base64url)
3. Store `codeVerifier` in `sessionStorage`
4. Redirect to `authorizeUrl?client_id=...&code_challenge=...&redirect_uri=/login/callback&response_type=code&scope=...&state=...`

#### 4. LoginCallbackPage (`pages/LoginCallbackPage.tsx`)

1. Extract `code` and `state` from URL query params
2. Retrieve `codeVerifier` from `sessionStorage`
3. POST `/api/auth/token` with `{ code, codeVerifier, redirectUri }`
4. Store returned JWT in `localStorage`
5. Redirect to `/`

#### 5. Auth Gate in `main.tsx`

```typescript
function AuthGate({ children }) {
  const { data: config } = useAuthConfig()  // GET /api/auth/config
  const token = getToken()

  // Auth not enabled → render app directly
  if (config && !config.enabled) return children

  // Auth enabled but no token → show login
  if (config?.enabled && !token) return <Navigate to="/login" />

  return children
}
```

#### 6. SSE/WebSocket with Token

`EventBus` updated to pass token as query param:
```typescript
const token = getToken()
const url = token ? `/api/events?token=${token}` : '/api/events'
this.source = new EventSource(url)
```

Terminal WebSocket similarly passes token in URL.

### No Settings UI for Auth

All auth configuration is operator-controlled via environment variables. No settings UI — this prevents authenticated users from modifying auth config or the whitelist at runtime.

### Migration

No database migration needed — auth is entirely env-var-based + localStorage client-side.

## Risks

1. **First-user bootstrap**: `AUTH_ALLOWED_USERS` is required when `AUTH_ENABLED=true`. Server refuses to start if auth is enabled but whitelist is empty — fail-fast with clear error message.
2. **OIDC discovery failure**: If the issuer's `.well-known` endpoint is unreachable at startup, server fails to start. Cached discovery is refreshed every 24h; if refresh fails, stale cache is used.
3. **SSE token in URL**: Token in query param may appear in server logs. **Mitigation**: httpLogger skips logging query params for `/api/events`.
4. **localStorage vs XSS**: localStorage is readable by any JS on the same origin. **Mitigation**: This is acceptable for a self-hosted tool; CSP headers + no user-submitted JS reduce risk. If XSS is a concern, a reverse proxy with cookie-based auth can be used in front.
5. **JWT secret rotation**: Changing `AUTH_SECRET` invalidates all sessions. **Mitigation**: Document this behavior; acceptable for self-hosted tool.

## Scope

### In Scope
- OIDC Discovery + OAuth PKCE flow (any OIDC-compliant provider)
- Server-signed JWT stored in frontend localStorage
- Bearer token auth for API/SSE/WebSocket
- Username whitelist enforcement via env var
- Auth toggle via env var
- Frontend LoginPage + CallbackPage + auth gate
- 401 auto-redirect in API client

### Out of Scope
- RBAC / role-based access control
- Multi-tenant / per-project permissions
- Refresh token rotation
- SAML / LDAP / other protocols
- User profile storage
- Settings UI for auth

## Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **OIDC PKCE + localStorage** (chosen) | Standard, minimal env vars (just issuer URL), stateless, SPA-friendly | Token in localStorage (XSS risk in theory) |
| OIDC PKCE + httpOnly cookie | XSS-safe token storage | Cookie domain issues with Vite proxy, CSRF concerns, EventSource needs workaround |
| API key only (`API_SECRET`) | Simplest | No user identity, shared secret, no SSO |
| Basic Auth + reverse proxy | No code changes | Bad UX, no SSO, no user granularity |

## Implementation Steps

1. Create `apps/api/src/auth/` module (types, config, oidc, jwt, middleware, routes)
2. Integrate auth middleware into `app.ts`
3. Add WebSocket/SSE token query param support
4. Update frontend API client with Bearer token + 401 handling
5. Create LoginPage and LoginCallbackPage
6. Create `use-auth.ts` hook and AuthGate in `main.tsx`
7. Update `EventBus` to pass token in SSE URL
8. Add i18n keys for auth UI
9. Update `.env.example` with auth env vars
10. Write tests for auth middleware, JWT, OIDC flow
11. Update CLAUDE.md with auth documentation
