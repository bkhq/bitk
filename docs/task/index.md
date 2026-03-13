# Task Index

> Format: `- [ ] **PREFIX-NNN Title** \`P1\` - owner: name - file: \`docs/task/PREFIX-NNN.md\``Markers:`[ ]`pending,`[-]`in progress,`[x]`completed,`[~]` closed

- [x] **CRASH-001 BKD 服务崩溃检测与关键日志记录** `P0` - owner: — - file: `docs/task/CRASH-001.md`
- [x] **CRASH-002 修复永久卡死根本原因** `P0` - owner: claude - file: `docs/task/CRASH-002.md`

## Chat UI

- [x] **CHAT-001 聊天界面 UI 优化（对标 Claude Code）** `P1` - owner: claude - file: `docs/task/CHAT-001.md`
- [-] **CHAT-002 聊天 UI 代码审查遗留项** `P2` - owner: claude - file: `docs/task/CHAT-002.md`

## Feature

- [x] **FEAT-001 添加 server_name 和 server_url 环境变量** `P2` - file: `docs/task/FEAT-001.md`
- [x] **FEAT-002 将 SERVER_NAME 和 SERVER_URL 从环境变量迁移到数据库** `P2` - owner: claude - file: `docs/task/FEAT-002.md`
- [x] **FEAT-003 MAX_CONCURRENT_EXECUTIONS 可通过设置配置** `P2` - owner: claude - plan: `PLAN-006` - file: `docs/task/FEAT-003.md`

## Engineering

- [x] **ENG-002 ACP SDK 接入并实现独立 ACP executor** `P1` - owner: codex - plan: `PLAN-009` - file: `docs/task/ENG-002.md`
- [x] **ENG-003 ACP engine 支持基于 model 的多 agent 路由** `P1` - owner: codex - plan: `PLAN-010` - file: `docs/task/ENG-003.md`
- [x] **ENG-004 拆分 ACP agent 定义为独立文件** `P1` - owner: codex - plan: `PLAN-013` - file: `docs/task/ENG-004.md`
- [x] **ENG-005 ACP tool call 消息按文档配对到产品状态** `P0` - owner: codex - plan: `PLAN-014` - file: `docs/task/ENG-005.md`
- [x] **ENG-006 ACP plan 与 diff 映射到现有产品 UI** `P0` - owner: codex - plan: `PLAN-015` - file: `docs/task/ENG-006.md`
- [x] **ENG-007 ACP tool result 优先显示格式化输出** `P1` - owner: codex - plan: `PLAN-016` - file: `docs/task/ENG-007.md`
- [x] **ENG-008 ACP 前端改造为协议原生时间线** `P1` - owner: codex - plan: `PLAN-017` - file: `docs/task/ENG-008.md`
- [x] **ENG-009 按功能模块拆分 ACP client** `P1` - owner: codex - plan: `PLAN-018` - file: `docs/task/ENG-009.md`
- [x] **ENG-010 在 ACP engine 中接入 Claude agent** `P1` - owner: codex - plan: `PLAN-019` - file: `docs/task/ENG-010.md`
- [x] **ENG-011 ACP 前端恢复工具组展示** `P1` - owner: codex - plan: `PLAN-020` - file: `docs/task/ENG-011.md`
- [x] **ENG-012 禁止会话内 follow-up 切换模型** `P1` - owner: codex - plan: `PLAN-021` - file: `docs/task/ENG-012.md`
- [x] **BUG-011 ACP 重复发射占位 tool action 导致前端重复展示** `P1` - owner: codex - plan: `PLAN-022` - file: `docs/task/BUG-011.md`

## Webhook

- [x] **WEBHOOK-001 完善 Webhook 通知元信息** `P1` - plan: `PLAN-002` - file: `docs/task/WEBHOOK-001.md`

## Backend Audit — CRITICAL

- [ ] **AUDIT-001 升级系统路径穿越漏洞** `P0` - file: `docs/task/AUDIT-001.md`
- [ ] **AUDIT-002 Notes 路由无项目作用域和权限检查** `P0` - file: `docs/task/AUDIT-002.md`
- [ ] **AUDIT-003 回收站全局暴露已删除 issue** `P0` - file: `docs/task/AUDIT-003.md`
- [ ] **AUDIT-004 Turn 完成异步结算竞态** `P0` - file: `docs/task/AUDIT-004.md`

## Backend Audit — HIGH

- [ ] **AUDIT-005 Engine 领域数据内存泄漏** `P1` - file: `docs/task/AUDIT-005.md`
- [ ] **AUDIT-006 Reconciler 检查范围过窄** `P1` - file: `docs/task/AUDIT-006.md`
- [ ] **AUDIT-007 Reconciler 与 spawn 竞态** `P1` - file: `docs/task/AUDIT-007.md`
- [ ] **AUDIT-008 Logs 端点 limit 参数未经 Zod 验证** `P1` - file: `docs/task/AUDIT-008.md`
- [ ] **AUDIT-009 子进程 exited Promise 无超时** `P1` - file: `docs/task/AUDIT-009.md`

## Backend Audit — MEDIUM

- [ ] **AUDIT-010 Lock 超时 lockDepth 计算错误** `P2` - file: `docs/task/AUDIT-010.md`
- [ ] **AUDIT-011 consumeStderr reader lock 未释放** `P2` - file: `docs/task/AUDIT-011.md`
- [ ] **AUDIT-012 finishedAt 时间戳竞态** `P2` - file: `docs/task/AUDIT-012.md`
- [ ] **AUDIT-013 parentId 查询参数未验证** `P2` - file: `docs/task/AUDIT-013.md`
- [ ] **AUDIT-014 上传文件 originalName 未清洗** `P2` - file: `docs/task/AUDIT-014.md`
- [ ] **AUDIT-015 工作区路径验证不完整** `P2` - file: `docs/task/AUDIT-015.md`
- [ ] **AUDIT-016 SSE 订阅部分创建后泄漏** `P2` - file: `docs/task/AUDIT-016.md`
- [ ] **AUDIT-017 数据库迁移错误匹配正则脆弱** `P2` - file: `docs/task/AUDIT-017.md`
- [ ] **AUDIT-018 SPA 静态文件 fallback 不可达** `P2` - file: `docs/task/AUDIT-018.md`
- [ ] **AUDIT-019 Execute/FollowUp 模型名正则不一致** `P2` - file: `docs/task/AUDIT-019.md`

## Backend Audit — LOW

- [ ] **AUDIT-020 Issues 列表无分页 limit** `P3` - file: `docs/task/AUDIT-020.md`
- [ ] **AUDIT-021 软删除不级联到 logs/attachments** `P3` - file: `docs/task/AUDIT-021.md`
- [ ] **AUDIT-022 sessionStatus 列无 CHECK 约束和索引** `P3` - file: `docs/task/AUDIT-022.md`
- [ ] **AUDIT-023 Cache sweep timer 无 shutdown 清理** `P3` - file: `docs/task/AUDIT-023.md`
- [ ] **AUDIT-024 Worktree 清理批次上限静默截断** `P3` - file: `docs/task/AUDIT-024.md`
- [ ] **AUDIT-025 上传路径泄露到 AI 引擎上下文** `P3` - file: `docs/task/AUDIT-025.md`
- [ ] **AUDIT-026 SSE writeSSE 序列化失败无日志** `P3` - file: `docs/task/AUDIT-026.md`
- [ ] **AUDIT-027 全局无速率限制** `P3` - file: `docs/task/AUDIT-027.md`

## Chat UI — Pagination

- [x] **CHAT-003 历史消息分页按会话消息计数** `P1` - owner: claude - plan: `PLAN-004` - file: `docs/task/CHAT-003.md`

## Pending Message

- [x] **FEAT-002 Pending 消息改造** `P1` - owner: claude - plan: `PLAN-005` - file: `docs/task/FEAT-002.md`

## Lint

- [x] **LINT-001 Migrate from Biome to ESLint + Prettier** `P1` - owner: claude - plan: `PLAN-006` - file: `docs/task/LINT-001.md`

## Stream Reliability

- [x] **STALL-001 stdout 断裂后 fallback 到 transcript JSONL** `P1` - owner: claude - plan: `PLAN-006` - file: `docs/task/STALL-001.md`

## UI Fix

- [x] **UI-001 Fix chat UI: visibility, grouping, collapsible tool groups** `P1` - owner: claude - plan: `PLAN-007` - file: `docs/task/UI-001.md`
- [x] **UI-002 Suppress queue-operation/progress raw text in chat** `P2` - owner: claude - file: `docs/task/UI-002.md`
- [x] **UI-003 Remove devMode feature entirely** `P2` - owner: claude - file: `docs/task/UI-003.md`

## Pipe Reliability

- [x] **PIPE-001 Claude executor 替换 Bun.spawn 为 node:child_process** `P0` - owner: claude - file: `docs/task/PIPE-001.md`
- [x] **PIPE-002 Release workflow 升级到 Node 24 兼容 actions** `P1` - owner: local - file: `docs/task/PIPE-002.md`

## Spawn Migration

- [x] **SPAWN-001 Replace all Bun.spawn with node:child_process** `P1` - owner: claude - plan: `PLAN-008` - file: `docs/task/SPAWN-001.md`

## Bug Fix

- [x] **BUG-001 未指定 root 目录时以自身所在目录为 root** `P1` - file: `docs/task/BUG-001.md`
- [x] **BUG-002 ChatInput 刷新按钮不可用** `P1` - file: `docs/task/BUG-002.md`
- [x] **BUG-003 升级不要自动下载，只提示新版本** `P1` - file: `docs/task/BUG-003.md`
- [x] **BUG-004 非 dev 模式不应返回 tool-use 消息** `P1` - owner: claude - file: `docs/task/BUG-004.md`
- [x] **BUG-005 File browser rejects valid worktree root paths** `P1` - owner: claude - file: `docs/task/BUG-005.md`
- [x] **BUG-006 Pending messages not displayed for todo issues** `P1` - owner: claude - file: `docs/task/BUG-006.md`
- [-] **BUG-007 升级后 /api/projects 因缺失 is_archived 列返回 500** `P0` - owner: local - file: `docs/task/BUG-007.md`
- [x] **BUG-008 ACP Codex model id 含 `/` 导致 400** `P1` - owner: codex - file: `docs/task/BUG-008.md`
- [-] **BUG-009 模型发现链路缺少可诊断日志** `P1` - owner: codex - plan: `PLAN-011` - file: `docs/task/BUG-009.md`
- [x] **BUG-010 ACP assistant streaming 未落地导致前端无返回** `P0` - owner: codex - plan: `PLAN-012` - file: `docs/task/BUG-010.md`
