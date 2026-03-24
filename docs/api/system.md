# System

## GET /api

API status check.

**Response:**

```json
{
  "success": true,
  "data": { "name": "bkd-api", "status": "ok", "routes": ["GET /api", "GET /api/health", "GET /api/runtime"] }
}
```

## GET /api/health

Health check with database status.

**Response:**

```json
{
  "success": true,
  "data": { "status": "ok", "version": "0.0.6", "commit": "abc1234", "db": "ok", "timestamp": "..." }
}
```

## GET /api/status

Detailed status with memory metrics.

**Response:**

```json
{
  "success": true,
  "data": {
    "uptime": 12345,
    "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0 },
    "db": { "ok": true }
  }
}
```

## GET /api/runtime

Runtime information including Bun/Node versions, process details, and platform info. Requires `ENABLE_RUNTIME_ENDPOINT=true` environment variable; returns `404` otherwise.

Sensitive fields (e.g. `execPath`) are stripped from the response.

## Authentication

Auth is enabled when `AUTH_ENABLED=true`. Auth routes are **public** (not behind the auth middleware).

### GET /api/auth/config

Returns auth configuration for the frontend. Never exposes secrets.

**Response (auth disabled):**

```json
{ "success": true, "data": { "enabled": false } }
```

**Response (auth enabled):**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "clientId": "...",
    "authorizeUrl": "https://...",
    "scopes": "openid profile email",
    "pkce": true
  }
}
```

### POST /api/auth/token

Exchange OIDC authorization code for a BKD session JWT.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | `string` | Yes | Authorization code from OIDC provider |
| `codeVerifier` | `string` | No | PKCE code verifier |
| `redirectUri` | `string` (URL) | Yes | Redirect URI used in the auth request |

**Response:** `{ token, user: { username, email } }`

Returns `403` if the user is not in the allowed users whitelist.

### GET /api/auth/me

Validate Bearer token and return current user info.

**Response:** `{ username, email }`

Returns `401` if token is missing or invalid.

### POST /api/auth/logout

Server-side no-op (stateless JWT). Frontend clears localStorage.
