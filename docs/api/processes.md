# Processes

Process routes are global (not project-scoped).

## GET /api/processes

List all active engine processes across all projects.

**Response:**

```json
{
  "success": true,
  "data": {
    "processes": [{
      "executionId": "...",
      "issueId": "...",
      "issueTitle": "...",
      "issueNumber": 1,
      "projectId": "...",
      "projectAlias": "...",
      "projectName": "...",
      "engineType": "claude-code",
      "processState": "running",
      "model": "...",
      "startedAt": "...",
      "turnInFlight": true,
      "spawnCommand": "...",
      "lastIdleAt": "...",
      "pid": 12345
    }]
  }
}
```

## POST /api/processes/:issueId/terminate

Terminate an engine process. Validates that the issue exists and its project is not deleted.

**Response:** `{ issueId, status: "terminated" }`
