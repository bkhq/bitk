# Task Index

> Format: `- [ ] **PREFIX-NNN Title** \`P1\` - file: \`docs/task/PREFIX-NNN.md\`` Markers: `[ ]` pending, `[-]` in progress, `[x]` completed, `[~]` closed

## Completed (archived)

50 tasks completed across: CRASH(2), AUTH(1), CHAT(2), FEAT(4), ENG(11), WEBHOOK(1), AUDIT(2), UI(3), PIPE(2), SPAWN(1), BUG(14), LINT(1), STALL(1), CRON(1). Detail files removed — see git history for details.

## In Progress

- [-] **CHAT-002 Chat UI code review leftovers** `P2`
- [-] **BUG-007 /api/projects 500 after upgrade due to missing is_archived column** `P0`
- [-] **BUG-009 Model discovery missing diagnostic logs** `P1`

## Audit — CRITICAL (P0)

- [ ] **AUDIT-001 Upgrade system path traversal** `P0`
- [ ] **AUDIT-002 Notes route missing project scope and auth** `P0`
- [ ] **AUDIT-003 Trash exposes deleted issues globally** `P0`
- [ ] **AUDIT-004 Turn completion async settlement race** `P0`
- [ ] **AUDIT-029 Files API caller-controlled root exposes host filesystem** `P0`
- [ ] **AUDIT-035 Upgrade restart accepts artifacts without integrity verification** `P0`
- [ ] **AUDIT-040 Webhook secrets sent as plaintext Bearer tokens** `P0`
- [ ] **AUDIT-041 Telegram bot token exposed in API URL** `P0`
- [ ] **AUDIT-042 Upgrade apply exits without verifying child process health** `P0`

## Audit — HIGH (P1)

- [ ] **AUDIT-005 Engine domain data memory leak** `P1`
- [ ] **AUDIT-006 Reconciler check scope too narrow** `P1`
- [ ] **AUDIT-007 Reconciler vs spawn race condition** `P1`
- [ ] **AUDIT-008 Logs endpoint limit param not Zod-validated** `P1`
- [ ] **AUDIT-009 Subprocess exited promise has no timeout** `P1`
- [ ] **AUDIT-030 Files API root containment check is prefix-based and bypassable** `P1`
- [ ] **AUDIT-036 Global SSE stream broadcasts cross-project activity** `P1`
- [ ] **AUDIT-037 Issue lock timeout releases before timed-out work stops** `P1`
- [ ] **AUDIT-038 MCP API key returned to frontend in plaintext** `P1`
- [ ] **AUDIT-043 Git detect-remote bypasses workspace sandbox** `P1`
- [ ] **AUDIT-044 Files API read operations do not verify symlinks** `P1`
- [ ] **AUDIT-045 No CORS middleware configured** `P1`
- [ ] **AUDIT-046 EventBus emit-during-unsubscribe race condition** `P1`
- [ ] **AUDIT-047 No SSE connection limit allows resource exhaustion** `P1`
- [ ] **AUDIT-048 Cache thundering herd in cacheGetOrSet** `P1`
- [ ] **AUDIT-049 MCP create-project bypasses workspace root validation** `P1`
- [ ] **AUDIT-050 Codex sendUserMessage error silently swallowed** `P1`
- [ ] **AUDIT-051 Upgrade download not cancellable** `P1`
- [ ] **AUDIT-052 Upgrade apply process.exit prevents finally block cleanup** `P1`

## Audit — MEDIUM (P2)

- [ ] **AUDIT-010 Lock timeout lockDepth calculation error** `P2`
- [ ] **AUDIT-011 consumeStderr reader lock not released** `P2`
- [ ] **AUDIT-012 finishedAt timestamp race** `P2`
- [ ] **AUDIT-013 parentId query param not validated** `P2`
- [ ] **AUDIT-014 Upload originalName not sanitized** `P2`
- [ ] **AUDIT-015 Workspace path validation incomplete** `P2`
- [ ] **AUDIT-016 SSE subscription partial creation leak** `P2`
- [ ] **AUDIT-017 DB migration error regex fragile** `P2`
- [ ] **AUDIT-018 SPA static file fallback unreachable** `P2`
- [ ] **AUDIT-019 Execute/FollowUp model name regex inconsistent** `P2`
- [ ] **AUDIT-031 Full compile injects mismatched version symbols** `P2`
- [ ] **AUDIT-033 Launcher release channel mutable via forced tag rewrite** `P2`
- [ ] **AUDIT-039 useIssueStream can drop log updates after live-log trimming** `P2`
- [ ] **AUDIT-053 MCP API key comparison not timing-safe** `P2`
- [ ] **AUDIT-054 Multipart form data bypasses prompt length validation** `P2`
- [ ] **AUDIT-055 Webhook SSRF prevention does not block DNS rebinding** `P2`
- [ ] **AUDIT-056 No shutdown timeout for graceful shutdown** `P2`
- [ ] **AUDIT-057 UPLOAD_DIR uses process.cwd() instead of ROOT_DIR** `P2`
- [ ] **AUDIT-058 Cache returns null for legitimate falsy cached values** `P2`
- [ ] **AUDIT-059 No merged prompt size limit for pending inputs** `P2`
- [ ] **AUDIT-060 Floating-point cost accumulation drift** `P2`
- [ ] **AUDIT-061 git status expensive in large repos for changes summary** `P2`
- [ ] **AUDIT-062 No webhook retry mechanism for failed deliveries** `P2`
- [ ] **AUDIT-063 dangerouslySetInnerHTML ESLint rule disabled globally** `P2`
- [ ] **AUDIT-064 API client missing AbortSignal propagation** `P2`
- [ ] **AUDIT-065 Terminal session store resource leak on reset** `P2`
- [ ] **AUDIT-066 No prefers-reduced-motion support for CSS animations** `P2`
- [ ] **AUDIT-067 Files and filesystem API lack shared path validation** `P2`
- [ ] **AUDIT-068 Compile script mutates tracked source files in place** `P2`
- [ ] **AUDIT-069 CI/release workflow actions not pinned to SHA** `P2`
- [ ] **AUDIT-070 Upload cleanup symlinks could cause out-of-directory deletion** `P2`
- [x] **AUDIT-071 Vite dev server allowedHosts:true disables host validation** `P2`
- [ ] **AUDIT-072 No GitHub API rate limit handling in upgrade checker** `P2`

## Audit — LOW (P3)

- [ ] **AUDIT-020 Issues list has no pagination limit** `P3`
- [ ] **AUDIT-021 Soft delete does not cascade to logs/attachments** `P3`
- [ ] **AUDIT-022 sessionStatus column has no CHECK constraint or index** `P3`
- [ ] **AUDIT-023 Cache sweep timer not cleaned on shutdown** `P3`
- [ ] **AUDIT-024 Worktree cleanup batch limit silently truncates** `P3`
- [ ] **AUDIT-025 Upload path leaks into AI engine context** `P3`
- [ ] **AUDIT-026 SSE writeSSE serialization failure not logged** `P3`
- [ ] **AUDIT-027 No global rate limiting** `P3`
- [ ] **AUDIT-032 FileBrowserPage implemented but unreachable from router** `P3`
- [x] **AUDIT-073 Multi-agent comprehensive repository review (2026-03-23)** `P1` - file: `docs/task/AUDIT-073.md`
