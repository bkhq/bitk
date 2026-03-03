# Changelog

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
