# CRON-001 Integrate cronbake and add MCP cron interface

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-03-23 11:20

## Description

Replace existing `setInterval`-based background jobs with cronbake scheduler. Create an independent `cron` module with:

1. `cron_jobs` and `cron_job_logs` database tables
2. Baker singleton with unified start/stop lifecycle
3. Builtin task migration (upload-cleanup, worktree-cleanup)
4. 6 MCP tools: `cron-list`, `cron-create`, `cron-delete`, `cron-trigger`, `cron-pause`/`cron-resume`, `cron-get-logs`

Acceptance criteria:
- All existing periodic jobs run via cronbake
- MCP clients can create/delete/trigger cron jobs dynamically
- Each execution is logged in `cron_job_logs` with duration, status, result/error
- `cron-get-logs` supports pagination and status filtering

## ActiveForm

Integrating cronbake cron module with MCP interface

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- cronbake v0.4.0, zero dependencies, MIT license
- Task types: `builtin`, `issue-execute`, `issue-follow-up`
- Builtin tasks do not create issues, use lightweight logging only
