# Changelog

## 2026-03-09 05:00 [BUG-P0]

PIPE-001: Replace Bun.spawn with node:child_process for Claude executor

- Root cause: Bun.spawn stdout pipe breaks prematurely while process still alive
- Process stays alive (stdin open) → subprocess.exited never resolves → no settlement → frontend stuck in "thinking"
- Created `engines/spawn.ts` — node:child_process wrapper with Bun Subprocess-compatible interface
- Updated `ClaudeProtocolHandler` stdin type from Bun `FileSink` to generic `StdinWriter`
- Replaced all 3 Bun.spawn calls in claude executor with `spawnNode()`
- Other executors (codex, gemini, echo) unchanged — only claude-code affected

## 2026-03-09 04:00 [progress]

UI-003: Remove devMode feature entirely

- Removed `devMode` column from DB schema + migration `0009_remove_dev_mode.sql`
- Removed `devMode` from `Issue` shared type
- Renamed `isVisibleForMode(entry, devMode)` → `isVisible(entry)` — no more per-issue bypass
- Removed `devModeCache` (Map), `getIssueDevMode`, `setIssueDevMode`
- Cleaned up `getLogsFromDb`, `getLogs`, `IssueEngine.getLogs` — removed dead `devMode` parameter
- Removed devMode from: route schemas, serializer, update handler, orchestration, lifecycle, SSE events
- Removed devMode toggle button from `IssueDetail.tsx` + i18n keys
- Updated `message-rebuilder.ts` — removed devMode from `RebuildOptions`, always applies filter rules

## 2026-03-09 03:30 [progress]

UI-002: Suppress queue-operation/progress/last-prompt raw text in chat

- `normalizer.ts` — add `queue-operation`, `progress`, `last-prompt` to switch to return null (suppresses raw XML like `<task-notification>` from appearing as plain text)

## 2026-03-09 03:00 [BUG-P1]

BUG-005: File browser rejects valid worktree root paths

- Decoupled file browser API from project context: `/api/files/show?root=<path>` (was `/api/projects/:projectId/files/show`)
- Removed project/worktree validation, only path traversal prevention remains
- Frontend resolves root from `rootPath ?? project.directory`
- Fixed `toggle()` leaking stale `rootPath` across projects

## 2026-03-09 03:00 [progress]

UI-001: Fix chat UI visibility, grouping, collapsible tool groups

- `visibility.ts` — allow all entry types in non-dev mode (BUG-004 regression fix); frontend `rebuildMessages` handles display filtering
- `queries.ts` — removed redundant `VISIBLE_ENTRIES_CONDITION` SQL filter
- `normalizer.ts` — suppress `task_progress` and `stop_hook_summary` subtypes (no user-facing content)
- `use-chat-messages.ts` — skip `task_progress`/`stop_hook_summary` instead of flushing tool buffer (fixes broken grouping)
- `ToolItems.tsx` — wrap `ToolGroupMessage` in `<details open>` with chevron for collapsible UI

## 2026-03-09 00:05 [progress]

FEAT-003：MAX_CONCURRENT_EXECUTIONS 可通过设置页面配置

- `ProcessManager` — `maxConcurrent` 改为可变，新增 `setMaxConcurrent()` 方法
- `IssueEngine` — 新增 `setMaxConcurrent()` + `initMaxConcurrent()` 启动时从 DB 读取
- `routes/settings/general.ts` — 新增 GET/PATCH `/api/settings/max-concurrent-executions`
- Frontend — 设置页 General 区域新增数字输入框，支持 1–20 范围
- i18n — 新增 `maxConcurrentExecutions` / `maxConcurrentExecutionsHint` 键

## 2026-03-08 23:50 [progress]

LINT-001: Migrate from Biome to ESLint + Prettier

- Removed `@biomejs/biome` and `biome.json`
- Added ESLint v9 (flat config `eslint.config.js`) + Prettier (`.prettierrc`)
- Converted 12 `biome-ignore` inline comments to `eslint-disable` equivalents
- Updated root `package.json` scripts: `lint`, `lint:fix`, `format`, `format:check`
- Updated docs: CLAUDE.md, AGENTS.md, development.md, architecture.md, frontend README
- Prettier ran across entire codebase for consistent formatting

Related plan: PLAN-006

## 2026-03-08 23:00 [progress]

STALL-001：stdout pipe 断裂后 fallback 到 transcript JSONL

解决 Claude CLI stdout pipe 偶发性异常关闭导致 9 分钟 stall detection 延迟的问题。

修改：

- `streams/transcript-fallback.ts`（新建）— 读取 transcript JSONL，转换格式后复用 normalizer 补齐缺失条目
- `process/register.ts` — consumeStream 结束后检测进程是否存活，存活则启动 transcript fallback，检测到 turn completion 后主动 settle
- `types.ts` — ManagedProcess 添加 `stdoutBroken`/`spawnCwd`/`externalSessionId` 字段
- `gc.ts` — stdoutBroken 时跳过 stall escalation
- `orchestration/execute.ts`、`restart.ts`、`lifecycle/spawn.ts` — 所有 register() 调用点设置 spawnCwd 和 externalSessionId

## 2026-03-08 21:00 [progress]

BUG-004：非 dev 模式不再返回 tool-use 和 system-message 条目

修改：

- `visibility.ts` — isVisibleForMode 非 dev 仅放行 user-message + assistant-message
- `persistence/queries.ts` — VISIBLE_ENTRIES_CONDITION 改为与 CONVERSATION_MSG_CONDITION 一致

## 2026-03-08 20:30 [progress]

CHAT-003 完成：历史消息分页按会话消息计数

修改：

- `apps/api/src/engines/issue/persistence/queries.ts` — `getLogsFromDb` 改为两步查询：先查会话消息边界（user-message + assistant-message），再获取范围内所有可见条目。返回类型改为 `PaginatedLogResult { entries, hasMore }`
- `apps/api/src/engines/issue/queries.ts` — `getLogs` 返回类型同步改为 `PaginatedLogResult`
- `apps/api/src/engines/issue/engine.ts` — `IssueEngine.getLogs` 签名更新
- `apps/api/src/routes/issues/logs.ts` — 移除 "fetch limit+1, trim" 逻辑，直接使用 `result.hasMore`

效果：limit=30 表示 30 条用户/助手消息，附带其间所有工具调用。全部 417 测试通过。

关联方案：PLAN-004

## 2026-03-08 21:10 [progress]

FEAT-002: 将 SERVER_NAME 和 SERVER_URL 从环境变量迁移到数据库

- `apps/api/src/db/helpers.ts` — 新增 `getServerName/getServerUrl/setServerName/setServerUrl/deleteAppSetting/ensureServerInfoDefaults`
- `apps/api/src/engines/reconciler.ts` — 启动时调用 `ensureServerInfoDefaults()` 自动迁移 env → DB
- `apps/api/src/routes/settings/general.ts` — 新增 `GET/PATCH /api/settings/server-info` 端点
- `apps/api/src/routes/settings/about.ts` — system-info 改为从 DB 读取
- `apps/api/src/webhooks/dispatcher.ts` — 改为从 DB 读取 SERVER_URL
- `apps/api/src/routes/issues/create.ts` — 改为从 DB 读取 SERVER_URL
- `apps/api/src/routes/issues/delete.ts` — 改为从 DB 读取 SERVER_URL
- `apps/frontend/src/lib/kanban-api.ts` — 新增 `getServerInfo/updateServerInfo` API
- `apps/frontend/src/hooks/use-kanban.ts` — 新增 `useServerInfo/useUpdateServerInfo` hooks
- `apps/frontend/src/components/AppSettingsDialog.tsx` — 设置页 General 区新增 server name/url 编辑表单
- `apps/frontend/src/i18n/{en,zh}.json` — 新增 i18n 键

关联方案：PLAN-004

## 2026-03-08 20:25 [progress]

CHAT-002: Code review 修复

- **[HIGH] messages.pop() 脆弱变异** — 改为 `pendingThinking` 携带变量，thinking 入口延迟推送，flushToolBuffer 消费或独立 flush
- **[MEDIUM] i18n 硬编码** — StickyTaskPlan 使用 `t('session.taskPlan')`
- **[MEDIUM] 不稳定 key** — todo list key 从 `item.content` 改为 `idx`（items 不独立重排）
- **[LOW] 空 todos 守卫** — `latestTaskPlan.todos.length > 0` 防止空状态栏

## 2026-03-08 20:15 [progress]

CHAT-002: Task Plan 状态栏 + ToolGroup "Show N more"

- **Task Plan 状态栏** — 底部紧凑栏（显示 in_progress 项 + 进度），点击向上展开完整列表；SSE 实时更新通过已有 log 管道自动生效
- **ToolGroup "Show N more"** — 展开时默认显示前 3 项，超出部分折叠为 "Show N more" 按钮

## 2026-03-08 20:10 [progress]

CHAT-002: 聊天 UI 4 项修复

1. **File Read 显示行数** — `ToolItems.tsx` FileToolItem 从 result.content 计算行数，显示 "Read N lines"
2. **ToolGroup 标题显示 thinking 描述** — `shared/index.ts` 增加 `description` 字段；`use-chat-messages.ts` flush 时吸收前一条 thinking 消息作为描述；`ToolItems.tsx` 优先显示 description
3. **Agent 工具项渲染** — 新增 `AgentToolItem` 组件，显示 "Agent" + description 标签 + 可折叠 result 内容
4. **Task Plan 固定底部** — `SessionMessages.tsx` 提取最新 task-plan，sticky bottom 渲染，不再内联显示

Build + 28 前端测试 + lint 通过。

## 2026-03-08 20:05 [progress]

CHAT-002: SessionMessages.tsx 拆分（620 行 → 3 个文件）

- `CodeRenderers.tsx` (~190 行) — stringifyPretty, parseFileToolInput, detectCodeLanguage, ShikiCodeBlock, CodeBlock, ShikiUnifiedDiff, ToolPanel
- `ToolItems.tsx` (~210 行) — FileToolItem, CommandToolItem, GenericToolItem, ToolGroupMessage
- `SessionMessages.tsx` (~160 行) — ChatMessageRow + SessionMessages 主导出

纯文件拆分，无逻辑变更。Build + 28 前端测试 + lint 通过。

## 2026-03-08 17:30 [progress]

CHAT-001 Phase 4 完成：回归验证 + 代码审查修复

修复：

- `apps/api/src/engines/process-manager.ts` — dispose() 增加 onRemove 循环，避免 ExecutionStore 泄漏
- `apps/frontend/src/hooks/use-chat-messages.ts` — idCounter 改为函数内局部变量，消除并发竞态；command_output 配对改为预索引 O(1) + 消费集合避免跨命令错配
- `apps/api/src/engines/issue/store/message-rebuilder.ts` — metadata.type 修正为 metadata.subtype；清理 consumedResults 死代码
- `apps/api/test/message-rebuilder.test.ts` — 测试数据对齐 metadata.subtype

全部 377 后端 + 28 前端测试通过。CHAT-001 标记完成。

关联方案：PLAN-003

## 2026-03-08 17:10 [progress]

CHAT-001 Phase 3 完成：前端适配

修改文件：

- `apps/api/src/engines/issue/utils/visibility.ts` — isVisibleForMode 开放 tool-use（normal mode 可见）
- `apps/api/src/engines/issue/persistence/queries.ts` — SQL 过滤 + tool detail 获取支持 tool-use
- `apps/frontend/src/hooks/use-chat-messages.ts` — 新增 useChatMessages hook（entries → ChatMessage[]）
- `apps/frontend/src/components/issue-detail/SessionMessages.tsx` — 重写为 ChatMessage 类型驱动渲染 + ToolGroupMessage 组件

关联方案：PLAN-003

## 2026-03-08 16:00 [progress]

CHAT-001 Phase 2 完成：后端 Pipeline 切换

修改文件：

- `apps/api/src/engines/executors/claude/normalizer.ts` — 移除 write filter 拦截，所有工具调用（Read/Glob/Grep）不再丢弃
- `apps/api/src/engines/types.ts` — createNormalizer 签名移除 WriteFilterRule 参数
- `apps/api/src/engines/issue/utils/normalizer.ts` — createLogNormalizer 同步化
- `apps/api/src/engines/issue/types.ts` — ManagedProcess.logs: RingBuffer → ExecutionStore
- `apps/api/src/engines/issue/process/register.ts` — 创建 ExecutionStore 替代 RingBuffer
- `apps/api/src/engines/process-manager.ts` — 新增 onRemove 回调
- `apps/api/src/engines/issue/engine.ts` — 注册 onRemove 自动销毁 ExecutionStore
- `apps/api/test/claude-normalizer.test.ts` — 更新测试

关联方案：PLAN-003

## 2026-03-08 14:30 [progress]

CHAT-001 Phase 1 完成：聊天界面 UI 优化后端基础设施

新增文件：

- `packages/shared/src/index.ts` — ChatMessage 类型（7 种变体）+ ToolProgressEvent/ToolGroupEvent + SSEEventMap 更新
- `apps/api/src/engines/issue/store/execution-store.ts` — 内存 SQLite per-execution 存储，RingBuffer 兼容接口
- `apps/api/src/engines/issue/store/message-rebuilder.ts` — 纯函数 rebuildMessages()，工具分组/配对/过滤
- `apps/api/test/execution-store.test.ts` — 10 个测试
- `apps/api/test/message-rebuilder.test.ts` — 10 个测试

关联方案：PLAN-003

## 2026-03-08 [progress]

- FEAT-001: 添加 `SERVER_NAME` 和 `SERVER_URL` 环境变量支持
  - 后端 `/api/settings/system-info` 新增 `server.name` / `server.url` 字段
  - 前端页面标题动态显示 `SERVER_NAME`（未设置时保持 "BKD"）
  - 复制链接使用 `SERVER_URL` 拼接外部 URL（未设置时回退 `window.location.origin`）
  - Webhook payload 自动注入 `issueUrl` 和 `projectId`（当 `SERVER_URL` 设置时）
  - 新增 `server-store.ts` Zustand store 和 `getIssueUrl()` 工具函数
- fix: 未配置项目目录时 fallback 从 `process.cwd()` 改为 `ROOT_DIR`（BUG-001）
- fix: ChatInput 刷新按钮不触发日志重新拉取，补充 `_refreshCounter` 到 effect 依赖数组（BUG-002）
- fix: 升级系统移除自动下载，改为仅检查并提示新版本（BUG-003）

## 2026-03-08 10:30 [progress]

**CRASH-002**: 修复永久卡死根本原因 + Issue 级别诊断日志

修复 4 个根因：

- `gc.ts`: GC sweep active process 循环加 per-entry try-catch，单个 entry 异常不再中断整个循环
- `turn-completion.ts`: catch 块内 DB 更新失败时记录日志而非静默丢弃；follow-up 分发时记录 debug 日志
- `lock.ts`: 执行超时时记录 error 日志；lock 持有超过 30s 记录 warn 日志
- `constants.ts`: stall 检测总时间从 10min 缩短到 6min（3+5+2 → 2+2+2）

Issue 级别诊断日志（`[BKD]` 前缀，持久化到 issueLogs，前端可见）：

- 新增 `diagnostic.ts`: `emitDiagnosticLog()` 工具函数，发出 `system-message` (subtype=diagnostic) 类型的日志条目
- `visibility.ts`: 诊断日志条目默认可见（non-dev 模式）
- `execute.ts`: 进程 spawn 成功/失败时记录
- `spawn.ts`: follow-up spawn 成功/失败/session recreate 时记录
- `completion-monitor.ts`: 进程退出（含 exit code/signal）、auto-retry 时记录
- `settle.ts`: issue settled 时记录
- `gc.ts`: stall 检测各阶段（detected → probe → force kill / process dead）记录

Per-issue debug 文件日志：

- 新增 `debug-log.ts`: `IssueDebugLog` 类 + `teeStreamToDebug()` 流分流函数
- `types.ts`: `ManagedProcess` 新增 `debugLog` 字段
- `register.ts`: 进程注册时创建 debug log，tee stdout/stderr 原始数据到 `data/logs/issues/<issueId>/debug.log`
- `executor.ts`: Claude Code 启动时添加 `--debug` 标志，输出到 `data/logs/issues/<issueId>/claude-debug.log`
- 每个 issue 生成两个 debug 文件：
  - `debug.log` — BKD 侧的原始 I/O（每行带时间戳 + stdout/stderr/event 标签）
  - `claude-debug.log` — Claude Code CLI 内部 debug 输出（API 调用、工具执行等）

## 2026-03-08 09:30 [progress]

**CRASH-001**: 添加崩溃检测与关键日志记录

- `index.ts`: 添加 `uncaughtException` + `unhandledRejection` 全局处理器；shutdown 记录活跃进程数和 uptime；重复信号处理日志
- `engine.ts`: GC sweep 调用包裹 try-catch，防止异常导致 stall detection 静默失效
- `consumer.ts`: stdout 流正常/异常结束记录日志；stderr catch 块不再静默丢弃错误
- `process-manager.ts`: 子进程退出记录 pid/exitCode/prevState；forceKill/SIGKILL 发送记录日志；stateChange/exit handler 异常记录日志
- `register.ts`: 流消费 promise resolve/reject 记录日志
