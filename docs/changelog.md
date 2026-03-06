# Changelog

## 2026-03-06 19:42 [progress]
修复 pending 消息被后端消费后前端仍停留在 queued 状态的问题：新增 `log-updated` 事件，后端在 promote pending user-message 后主动广播更新，前端 `useIssueStream` 按 `messageId` 就地 upsert 已有日志项。新增前后端聚焦测试。排查过程中确认后端测试失败并非 `drizzle-orm` 版本问题，而是当前 worktree 的安装产物残缺；定向重装依赖后恢复，`bun test apps/api/test/pending-messages-unit.test.ts` 与前端 hook 测试均通过。

## 2026-03-04 20:42 [progress]
启动修复工作并完成二轮修复：1) 修复 `handleTurnCompleted` 自动 flush pending 路径中“先 promote 再 follow-up”导致失败后 pending 语义丢失的问题（改为 follow-up 成功后再 promote）；2) 加固 `withIssueLock` 获取超时分支的 `lockDepth` 清理；3) 新增 `turn-completion-regression.test.ts` 覆盖 auto-flush 失败时 pending 可重试；4) 修复 `followup-reconciliation` 中顺序敏感断言导致的 flaky。回归结果：全仓 `bun run test` 通过，`@bitk/api` 278 pass / 0 fail。

## 2026-03-04 20:31 [progress]
完成进程/状态管理深度测试与架构补充：1) 新增 `issue-lock.test.ts` 覆盖同 issue 串行互斥、队列上限拒绝、锁获取超时恢复；2) 新增 `startup-probe.test.ts` 覆盖 probe 并发去重与清缓存后二次 live probe；3) 修复 `withIssueLock` 超时分支会丢失前序锁 tail 的问题（改为恢复 `currentTail`）；4) 在 `docs/architecture.md` 增补“Process/State Orchestration Deep Dive”与测试覆盖矩阵。回归结果：`@bitk/api 277 pass / 0 fail`，全仓 `bun run test` 通过。

## 2026-03-04 20:14 [progress]
继续补充并完善测试：1) 新增 `DELETE /api/projects/:id` 与 `DELETE /api/projects/:projectId/issues/:id` 集成测试，覆盖软删除后不可读、父子 issue 级联不可见；2) 在 `api-process-state-regression` 新增删除成功路径断言（terminate 被调用、仅活跃 issue 被终止）；3) 全量回归通过，后端测试提升到 272 个用例（0 fail），全仓 `bun run test` 通过。

## 2026-03-04 19:45 [progress]
完成后端进程与 Issue 状态管理审计后的首轮修复：1) `flushPendingAsFollowUp` 改为 follow-up 成功后才 promote pending，避免失败时消息不可重试；2) `executeIssue` / `restartIssue` 增加 spawn 失败回滚（`sessionStatus -> failed` + 失败状态事件）；3) issue/project 删除前由软 cancel 改为强制 terminate 并等待，防止删除后残留活跃进程；4) auto-execute 工作目录越界从提前返回改为抛错进入统一失败分支，避免 `pending` 卡死。

## 2026-03-03 04:00 [progress]
重构事件引擎：将 3 套独立 pub/sub（issue-events Set、changes-summary Set、EngineContext 回调 Map）统一为 AppEventBus 单一事件总线。新增 pipeline.ts 管道（middleware:devMode → order:10 DB持久化 → order:20 ringBuffer → order:30 自动标题 → order:40 逻辑失败 → order:100 SSE），DB 失败不再阻断 SSE 推送。共享类型（SSEEventMap、AppEventMap、ChangesSummary）定义在 @bitk/shared，前后端共用。handleStreamEntry 从 ~100 行简化为 ~25 行，EngineContext 移除 4 个回调字段，events.ts 从 91 行瘦身为 23 行薄 emit helpers。全部 283 后端测试 + 26 前端测试通过。

## 2026-03-03 02:00 [progress]
修复客户端设置弹窗横向滚动：在设置对话框两个 tab 内容容器添加 `overflow-x-hidden`，并对 About/模型卡片中的长文本与状态区域增加 `min-w-0`、`truncate`、`flex-wrap` 防止撑宽；同时将设置弹窗宽度提升为 `sm:max-w-xl md:max-w-2xl`。

## 2026-03-01 03:15 [progress]
修复 API 后端 23 个测试失败（所有修改仅限测试文件，源码无变更）：状态码 201→202 对齐、pending 消息元数据键 `{ type: 'pending' }` 对齐、codex normalizeLog 工具名 Bash/Edit 对齐、引擎探测超时增加、filesystem 403 断言放宽、flush 竞态条件修复。最终 208 测试全部通过。

## 2026-03-01 01:10 [progress]
Moved `drizzle/` migrations directory and `drizzle.config.ts` from monorepo root into `apps/api/`, moved `drizzle-kit` dependency to `@bitk/api`, and updated root db scripts to proxy via `bun --filter`. Prevents future conflicts if other workspaces need their own databases.

## 2026-02-28 05:45 [progress]
Initialized PMA project-management files (`docs/task/*`, `docs/plan/*`, format docs, architecture/changelog) and migrated active tasks into PMA task index/detail tracking.

## 2026-02-28 05:47 [decision]
Switched project workflow guidance from `/ptask` to `/pma` in AGENTS/CLAUDE and marked `task.md` as legacy archive for transition compatibility.

## 2026-02-28 05:55 [progress]
Moved legacy archive file from repository root `task.md` to `docs/task.md` and updated active guidance references.

## 2026-02-28 06:03 [progress]
Added `docs/tmp/` to `.gitignore` to keep temporary documentation artifacts out of version control.

## 2026-03-01 00:21 [progress]
Optimized frontend bundle loading by fixing Shiki slim alias compatibility for `langs-bundle-full-*`, deferring terminal drawer/runtime with lazy imports, and lazy-loading heavy diff components. Build verification confirms `cpp-*` and `emacs-lisp-*` chunks are no longer emitted.
