# System

## GET /api

API status check.

**Response:**

```json
{
  "success": true,
  "data": { "name": "bkd-api", "status": "ok", "routes": [...] }
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
  "data": { "uptime": 12345, "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0 }, "db": "ok" }
}
```

## GET /api/runtime

Runtime information. Requires `ENABLE_RUNTIME_ENDPOINT=true`.
