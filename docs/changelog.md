# Changelog

## 2026-03-15 03:00 [progress]

FEAT-004 / PLAN-024: Issue context menu and export

- Added `isPinned` column to issues table with migration `0012_add_is_pinned.sql`
- New `POST /:id/duplicate` endpoint copies issue metadata to a new todo-status issue
- New `GET /:id/export?format=json|txt` endpoint exports issue chat logs as downloadable files
- Created `IssueContextMenu` component with actions: Pin/Unpin, Rename, Copy, Download (JSON/TXT), Delete
- Wired context menu into `KanbanCard` (with `showPin=true`) and `IssueListPanel` `IssueRow` (with `showPin=false`)
- Pinned issues now sort to the top of each status column in the board store
- Added i18n keys for all context menu strings (zh + en)

## 2026-03-13 21:10 [progress]

- BUG-012 / PLAN-023: Keep pending messages separate and editable
- `apps/api/src/db/pending-messages.ts` now stores each queued message as its own row and supports per-message lookup/delete/relocation
- `apps/api/src/routes/issues/message.ts` now recalls pending rows by `messageId` and flushes queued follow-ups one message at a time
- `apps/api/src/routes/issues/command.ts` and `apps/api/src/engines/issue/orchestration/restart.ts` no longer pre-merge all pending prompts before execution
- `apps/frontend/src/components/issue-detail/ChatBody.tsx` and `SessionMessages.tsx` now let users edit pending rows individually
- Added regression coverage for separate pending storage, per-message recall, and queued done-message flushing

## 2026-03-13 04:54 [progress]

ENG-011 / PLAN-020: Restore grouped tool rendering for ACP

- Updated `useAcpTimeline()` to buffer consecutive ACP tool entries into a single `tool-group`
- Switched `AcpTimeline.tsx` to reuse the existing `ToolGroupMessage` renderer for better product consistency
- Kept `plan`, `assistant`, and `system/session` entries as standalone timeline items
- Added a hook test to lock contiguous ACP tool-call grouping behavior

## 2026-03-13 04:46 [progress]

ENG-010 / PLAN-019: Add Claude as a third ACP agent

- Added `apps/api/src/engines/executors/acp/agents/claude.ts` using `@zed-industries/claude-code-acp`
- Extended the ACP registry and model parser so Claude models use the `acp:claude:<model>` format
- Added probe-result versioning in `db/helpers.ts` so old cached engine discovery does not hide newly added ACP agents
- Verified API output now includes `acp:claude:default`, `acp:claude:sonnet`, and `acp:claude:haiku`

## 2026-03-13 04:30 [progress]

ENG-009 / PLAN-018: Split ACP client into functional modules

- Extracted ACP event/state definitions into `apps/api/src/engines/executors/acp/types.ts`
- Extracted subprocess/event-stream bridge into `apps/api/src/engines/executors/acp/transport.ts`
- Extracted log normalization into `apps/api/src/engines/executors/acp/normalizer.ts`
- Extracted ACP session/prompt handling into `apps/api/src/engines/executors/acp/protocol-handler.ts`
- Reduced `acp-client.ts` to a stable public entrypoint that keeps existing exports working

## 2026-03-13 04:24 [progress]

ENG-008 / PLAN-017: Add a dedicated ACP frontend renderer

- Added `useAcpTimeline()` to reconstruct ACP logs as a protocol-native ordered timeline instead of forcing them into the legacy grouped chat model
- Added `AcpTimeline.tsx` as an ACP-specific renderer that reuses the existing tool cards and diff/command display components
- Routed `SessionMessages` by `engineType`, so ACP issues now use the dedicated renderer while non-ACP engines keep the current UI
- Added targeted hook tests for ACP plan mapping, paired tool rendering, and streaming assistant replacement

## 2026-03-13 04:12 [progress]

ENG-008 / PLAN-017: Investigate ACP-native frontend timeline redesign

- Traced the current frontend path: `useIssueStream() -> useChatMessages() -> SessionMessages`
- Confirmed ACP data is already present in logs, but the frontend still forces it into legacy `ChatMessage` shapes
- Proposed a staged ACP-native timeline design with a dedicated adapter and renderer, keeping non-ACP engines on the existing UI until migration is complete

## 2026-03-13 04:06 [progress]

ENG-007: Prefer readable ACP tool result output over raw JSON blobs

- `acp-client.ts`: added readable output extraction for `tool_call_update.rawOutput`
- Preferred fields are `formatted_output`, `stdout`, `aggregated_output`, `stderr`, then nested `output/result/text/content`, with JSON stringify as the fallback
- `acp-client.test.ts`: added a unified-exec-style result test to lock the priority order
- Runtime verification on issue `dedeh172`, turn `9`: the `tool-use` result now persists as the three path lines directly instead of a serialized JSON object

## 2026-03-13 02:20 [progress]

- ENG-003 / PLAN-010: 将 `acp` engine 扩展为基于 model 前缀的多 agent 路由
- 新增 `apps/api/src/engines/executors/acp/agents.ts`，统一管理 Gemini / Codex 的 command、auth、availability 与模型前缀
- 约定 ACP 模型 ID 格式为 `acp:<agent>:<model>`，首批接入 `gemini` 和 `codex`
- `AcpExecutor` 现在根据 model 前缀选择底层 ACP agent，`getModels()` 聚合多个 agent 的模型列表
- 请求 schema 已放宽，允许 `model` 中包含 `:`
- 运行时 smoke test 通过：Gemini 与 Codex 都完成 `initialize -> newSession -> prompt -> turnCompleted`

## 2026-03-12 12:20 [progress]

PIPE-002: Update release workflow for GitHub Actions Node 24 migration

- Upgraded `actions/upload-artifact` from `v4` to `v7`
- Upgraded `actions/download-artifact` from `v4` to `v8`
- Kept `softprops/action-gh-release@v2` in place without enabling the temporary Node 24 force flag
- Fixed the release job artifact path by downloading `bkd-app-package` into `artifacts/bkd-app-package`
- Upgraded `actions/checkout` from `v4` to `v6` and `actions/cache` from `v4` to `v5`
- Replaced `oven-sh/setup-bun@v2` with shell-based Bun installation in CI, release, and launcher workflows
- Scope limited to release workflow compatibility; no release behavior changes requested
## 2026-03-09 06:00 [progress]

SPAWN-001: Replace all remaining Bun.spawn with node:child_process

- Extended `engines/spawn.ts` with `Subprocess` interface, `spawnNodeSync()`, `runCommand()`, `resolveCommand()`
- Migrated all engine executors: codex, gemini, echo (claude was done in PIPE-001)
- Migrated process-manager.ts type import to use generic `Subprocess` from spawn.ts
- Migrated utility callers: worktree.ts, changes-summary.ts, files.ts, git.ts, changes.ts, apply.ts, terminal.ts
- Migrated command.ts: `Bun.which()` → `resolveCommand()`
- Migrated echo executor: `Bun.sleep()` → `setTimeout` promise
- Only remaining Bun.spawn: PTY terminal (requires Bun-specific `terminal` option, no Node.js equivalent without node-pty)
- All tests pass (357/357, 7 pre-existing failures unrelated to this change)

Related plan: PLAN-008

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

## 2026-03-12 06:45 [BUG-P0]

- 修复 `apps/api/drizzle/meta/_journal.json` 中 `0011_sleepy_captain_marvel` 的 `when` 倒序问题
- 原值早于 `0010_smart_bullseye`，会被 Drizzle 迁移器按 `created_at` 过滤逻辑永久跳过
- 修复后自动迁移可继续在升级时补上 `projects.is_archived` 列

## 2026-03-13 18:10 [progress]

- ENG-002 / PLAN-009: 新增独立 `acp` engine，并将 ACP client 从供应商实现中抽离
- 新增 `apps/api/src/engines/executors/acp/acp-client.ts`，使用 `@agentclientprotocol/sdk` 驱动默认 ACP agent
- `spawn` / `spawnFollowUp` / `sendUserMessage` / `cancel` 已接入 ACP session
- `getModels()` 改为通过 ACP `newSession()` 读取真实模型列表
- 保留对历史 `gemini` engine 值的兼容映射，避免旧数据失效
- 运行时 smoke test 通过：成功收到 `thinking`、`assistant-message` 和 `turnCompleted`

## 2026-03-13 18:45 [BUG-P0]

- BUG-010 / PLAN-012: 修复 ACP follow-up 只有 streaming chunk、前端无 assistant 返回的问题
- `AcpExecutor` 改为使用 stateful `AcpLogNormalizer`，在 `agent_message_chunk` 期间累积文本
- turn 结束时先补一条非 streaming `assistant-message`，再保留原有 turn completed system entry
- 运行时复现 `acp:codex:gpt-5.3-codex/medium` follow-up，`/logs` 已能看到最终 assistant 回复 `PONG`

## 2026-03-13 18:55 [progress]

- ENG-004 / PLAN-013: 将 ACP agent 定义从单一 `agents.ts` 拆分为 `agents/base.ts`、`agents/gemini.ts`、`agents/codex.ts` 与 `agents/index.ts`
- 保持 `AcpExecutor` 与测试的导入 API 不变，仅重组内部 registry 和共享 helper
- 为后续继续接入新的 ACP agent 预留清晰边界

## 2026-03-13 19:10 [progress]

- ENG-005 / PLAN-014: 按 ACP 协议语义实现 stateful tool-call normalizer
- `tool_call` 现在产出 action entry，`tool_call_update` 在结果信号或 turn 结束时产出 `isResult: true` 的 result entry
- ACP tool state 现在保留 `title`、`kind`、`status`、`rawInput`、`rawOutput`、`content`、`locations`，并映射到现有 `toolAction` / `toolDetail.raw`
- 运行时用 `acp:codex:gpt-5.3-codex/medium` 验证，turn 7 已在 SQLite 中落下成对的 tool-use action/result

## 2026-03-13 19:25 [progress]

- ENG-006 / PLAN-015: 将 ACP `plan` update 映射到现有 task-plan UI，将 ACP `diff` 内容映射到现有 compare renderer
- `use-chat-messages` 现在会把 `system-message(subtype=plan)` 重建为 `task-plan`
- `ToolItems` 现在会从 ACP metadata 中提取 `diff { path, oldText, newText }` 并复用现有 `ShikiUnifiedDiff`
- 新增前端测试 `use-chat-messages.test.tsx` 覆盖 ACP plan -> task-plan 映射

## 2026-03-13 05:18 [decision]

- ENG-012 / PLAN-021: 禁止在已有 session 的 issue 上通过 follow-up 切换模型
- `POST /issues/:id/follow-up` 现在会在已有 `externalSessionId` 且显式 `model` 变化时返回 `409`
- `ChatInput` 在已有 session 时锁定模型选择，并且 follow-up 不再主动发送 `model`
- 这样将“会话延续”和“模型切换”明确拆开，后续如需换模型，统一通过 restart 语义处理

## 2026-03-13 05:28 [BUG-P1]

- BUG-011 / PLAN-022: 修复 ACP normalizer 对同一 `toolCallId` 重复发射占位 action 与具体 action
- 典型受影响工具是 `Read File` 与 `Terminal`，此前会先落一条泛化工具，再落一条带路径/命令的真实工具
- ACP normalizer 现在只会在拿到足够具体的信息后发射 action，并保证每个 `toolCallId` 最多只发一次 action
- 新增 ACP 定向回归测试，覆盖占位 `Read File` 后续升级为 `file-read` 的场景

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

## 2026-03-18 20:50 [progress]

- BUG-013: 原生 `claude-code` probe 不再通过 `claude -p --output-format text --max-turns 1 --no-chrome -- hi` 发起真实会话验证认证状态
- `ClaudeCodeExecutor.getAvailability()` 现在仅保留本地二进制与版本检查，认证状态改为读取 `ANTHROPIC_API_KEY` 或 `~/.claude/.credentials.json`
- 这样可避免 hooks、插件刷新、skills 注入与 API 过载把已安装且已有本地凭据的 Claude 误判为不可用

## 2026-03-18 21:10 [progress]

- BUG-014: 删除原生 `claude-code` 的 stdout transcript fallback 运行时链路
- 移除了 `engines/executors/claude/transcript-fallback.ts`、`ManagedProcess.stdoutBroken/lastSeenUuid` 以及 GC 中针对该 fallback 的特殊分支
- `/api/projects/:projectId/processes` 与前端进程面板不再暴露 transcript JSONL 路径；stdout pipe 异常结束时仅记录诊断日志，不再尝试补读 transcript

## 2026-03-18 21:20 [progress]

- BUG-015: 创建任务弹窗中的工作树开关默认值改为关闭
- Git 仓库项目不再自动把工作树开关同步为开启；仅在非 Git 仓库场景下强制保持关闭
- 创建成功后表单重置也恢复为工作树关闭，只有用户主动开启时才会提交 `useWorktree=true`

## 2026-03-18 22:05 [progress]

- BUG-016: 修复当前仓库前后端全部 `tsc --noEmit` 错误
- 先通过 `bun install` 恢复缺失依赖，清除了前端 Atlaskit 拖拽模块和 API 侧 ACP SDK 的解析失败
- 修复了 API 侧的缓存排序、Drizzle `isDeleted` 比较、pending message 可见性更新、Claude normalizer 内部事件联合类型、issue 查询与 message rebuild 严格空值问题，以及 terminal 路由的类型收窄
- 同步修正了相关测试中的联合返回类型辅助函数、过期断言、`sortOrder` 类型和 `ExecutionStore` / `ManagedProcess` 测试桩
## 2026-03-19 11:30 [progress]

- AUDIT-028 / PLAN-027: completed a repository-wide modular audit and wrote reports under `docs/codex-audit/`
- Added module reports for API runtime, API execution, API data/upgrade, frontend app shell, frontend high-privilege surfaces, and repository infrastructure
- Re-mapped existing `AUDIT-001` to `AUDIT-027` backlog items into the new module reports for easier triage
- Registered new findings as `AUDIT-029` to `AUDIT-039`, including unrestricted `/api/files` root control, unverified upgrade activation, cross-project SSE broadcast exposure, issue-lock timeout mutual-exclusion breakage, MCP API key plaintext exposure, and release/build path drift
