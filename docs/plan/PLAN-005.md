# PLAN-005 Pending 消息改造

- **status**: completed
- **task**: FEAT-002
- **owner**: claude

## 背景

当前 pending 消息系统问题：
- `promotePendingMessages()` 原地修改 metadata 去掉 pending 标记，消息保留在原始 ULID 位置，不反映实际处理顺序
- 多条 pending 各自独立行，消费时合并，但前端无法统一显示/撤回
- 无竞态保护

## 方案

### 1. DB 层：插入时合并

`upsertPendingMessage(issueId, content, metadata)`:
- 查找已有 pending 行（`visible=1 AND metadata.type='pending'`）
- 若存在：UPDATE content 追加 `\n\n` + 新内容，更新 metadata
- 若不存在：INSERT 新行

### 2. DB 层：删除 pending

`deletePendingMessage(issueId)`:
- 删除（或 visible=0）pending 行
- 返回被删除的内容和附件信息，供前端填入输入框

### 3. DB 层：重定位 pending

`relocatePendingMessages(issueId)`:
- 在事务中：读取 pending 行内容 → 标记 `visible=0`（乐观锁 `WHERE visible=1`）→ 返回内容
- 调用方用 `persistUserMessage` 在当前位置创建新条目
- 发 `log-removed` SSE 通知前端删除旧 pending

### 4. SSE：log-removed 事件

新增 `emitIssueLogRemoved(issueId, messageIds)` 函数，前端收到后从列表移除对应条目。

### 5. 前端：pending 置底 + 撤回

- `use-chat-messages.ts`: 从 entries 中提取 pending，从正常列表移除，单独返回
- 聊天 UI: pending 消息固定在底部，带"编辑"按钮
- 编辑: 调用 DELETE API → 内容填入输入框

### 6. 竞态保护

relocate 使用 `UPDATE SET visible=0 WHERE visible=1 AND id=?`，检查 affected rows。若为 0 说明已被用户撤回，跳过处理。

## 修改文件

| 文件 | 变更 |
|------|------|
| `apps/api/src/db/pending-messages.ts` | upsertPendingMessage, deletePendingMessage, relocatePendingMessages |
| `apps/api/src/routes/issues/message.ts` | 使用 upsertPendingMessage |
| `apps/api/src/routes/issues/logs.ts` | DELETE pending 端点 |
| `apps/api/src/events/issue-events.ts` | emitIssueLogRemoved |
| `apps/api/src/engines/issue/lifecycle/turn-completion.ts` | relocate 替代 promote |
| `apps/api/src/routes/issues/_shared.ts` | flushPendingAsFollowUp + triggerIssueExecution 统一 |
| `apps/frontend/src/hooks/use-chat-messages.ts` | pending 置底 |
| `apps/frontend/src/components/issue-detail/` | 撤回 UI |
| `apps/frontend/src/lib/kanban-api.ts` | deletePendingMessage API |

## 风险

- 竞态：编辑撤回与 auto-flush 同时操作 → 乐观锁解决
- 附件：合并时附件都指向同一个 pending logId，撤回时需返回所有附件
