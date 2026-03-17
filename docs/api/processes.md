# Processes

## GET /api/projects/:projectId/processes

List active engine processes for a project.

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
      "engineType": "claude-code",
      "processState": "running",
      "model": "...",
      "startedAt": "...",
      "turnInFlight": true,
      "spawnCommand": "...",
      "lastIdleAt": "...",
      "pid": 12345,
      "transcriptPath": "..."
    }]
  }
}
```

## POST /api/projects/:projectId/processes/:issueId/terminate

Terminate an engine process.

**Response:** `{ issueId, status: "terminated" }`
