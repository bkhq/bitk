# PLAN-002 完善 Webhook 通知元信息

- **status**: completed
- **task**: `WEBHOOK-001`
- **owner**:
- **created**: 2026-03-08

## 背景

当前 webhook 通知 payload 过于简略，缺少项目名、标题、编号、可点击 URL 等关键信息。状态变更通知对所有状态都触发（含无意义的 working），且 webhook channel 类型可被修改导致配置错乱。

## 调查结果

### 当前 payload 问题

| 事件 | 当前字段 | 缺失 |
|---|---|---|
| issue.created | issueId, projectId, title, statusId | issueNumber, projectName, issueUrl, engineType, model |
| issue.deleted | issueId, projectId, title | issueNumber, projectName, issueUrl |
| issue.updated | issueId, changes | projectId, projectName, title, issueNumber, issueUrl |
| issue.status_changed | issueId, changes | projectId, projectName, title, issueNumber, issueUrl, oldStatus, newStatus |
| session.started | issueId, executionId | projectId, projectName, title, issueNumber, issueUrl, engineType, model |
| session.completed | issueId, executionId, finalStatus | projectId, projectName, title, issueNumber, issueUrl |
| session.failed | issueId, executionId, finalStatus | projectId, projectName, title, issueNumber, issueUrl, lastLog |

### 关键文件

- `apps/api/src/webhooks/dispatcher.ts` — 事件监听 + 分发 + Telegram 格式
- `apps/api/src/routes/issues/create.ts` — issue.created 触发点
- `apps/api/src/routes/issues/delete.ts` — issue.deleted 触发点
- `apps/api/src/routes/settings/webhooks.ts` — webhook CRUD 路由
- `apps/frontend/src/components/settings/WebhookSection.tsx` — 前端配置 UI
- `apps/api/src/events/issue-events.ts` — emitIssueUpdated 事件
- `apps/api/src/engines/issue/events.ts` — emitStateChange / emitIssueSettled
- `apps/api/src/db/schema.ts` — issueLogs 表结构

## 实施步骤

### Step 1: dispatcher.ts — 添加 issue 查询辅助函数 + issueUrl 生成

- 新增 `getIssueMetadata(issueId)` 函数：查询 issue 的 title, issueNumber, projectId，再查 project 的 name
- 新增 `buildIssueUrl(projectId, issueId)` 函数：读取 `process.env.BKD_EXTERNAL_URL`，拼接 URL
- 新增 `getLastAgentLog(issueId)` 函数：查询最后一条 `entryType='assistant-message'` 的 content，截断 500 字符

### Step 2: dispatcher.ts — 丰富 issue-updated 事件处理

- `issue.status_changed`：仅在 newStatus 为 `todo`, `review`, `done` 时分发
- 从 changes 提取 oldStatus（如果可用）和 newStatus
- 调用 getIssueMetadata 补充 projectId, projectName, title, issueNumber, issueUrl

- `issue.updated`：调用 getIssueMetadata 补充元信息

### Step 3: dispatcher.ts — 丰富 session 事件处理

- `session.started`：调用 getIssueMetadata 补充元信息 + engineType, model
- `session.completed`：调用 getIssueMetadata 补充元信息
- `session.failed`：调用 getIssueMetadata + getLastAgentLog 补充元信息和 lastLog

### Step 4: dispatcher.ts — 更新 Telegram 消息格式

- 所有消息增加 `Project: {projectName}` 行
- Issue 行改为 `#issueNumber title`，有 URL 时做成可点击链接
- session.failed 增加 lastLog 显示
- review 状态增加"会话已完成"提示
- session 事件显示 engine + model

### Step 5: create.ts / delete.ts — 丰富直接 dispatch 的 payload

- issue.created：增加 issueNumber, projectName, issueUrl, engineType, model
- issue.deleted：增加 issueNumber, projectName, issueUrl

### Step 6: webhooks.ts — channel 类型不可修改

- updateSchema 移除 channel 字段
- PATCH 路由中不处理 channel 参数

### Step 7: WebhookSection.tsx — 前端编辑模式隐藏 channel 选择

- 编辑对话框中隐藏 channel 类型切换器
- 显示当前 channel 类型为只读标签

### Step 8: 验证

- 运行后端测试 `bun run test:api`
- 运行前端测试 `bun run test:frontend`
- 运行 lint `bun run lint`

## 风险

- `BKD_EXTERNAL_URL` 未设置时 issueUrl 为空 → 不包含该字段即可
- dispatcher 中新增 DB 查询是异步但 fire-and-forget → 不影响主流程
- issue 在 dispatch 前被删除 → getIssueMetadata 返回 null 时 fallback 到仅基本字段
