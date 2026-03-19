# AUDIT-049 MCP create-project bypasses workspace root validation

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Security
- **source**: claude-audit/backend-subsystems.md
- **created**: 2026-03-19

## Location

- `apps/api/src/mcp/server.ts`

## Description

The MCP `create-project` tool calls `resolve(directory)` but does not use `resolveWorkingDir()` to validate against workspace root. MCP clients can create projects pointing to arbitrary filesystem locations, bypassing the workspace sandbox.

## Fix Direction

Use the same `resolveWorkingDir()` validation used by HTTP routes. Reject directories outside the configured workspace root.
