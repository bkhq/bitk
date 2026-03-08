# FEAT-002 Pending 消息改造

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-03-08

## 描述

改造 pending 消息系统：

1. **插入合并**: 多条 pending 在 DB 层合并为单条（追加内容 + 合并附件）
2. **底部置顶**: 前端始终将 pending 消息显示在聊天底部
3. **撤回/编辑**: 用户可撤回 pending，删除 DB 行，内容填入输入框
4. **处理重定位**: AI 处理 pending 时，在当前 ULID 位置创建新条目，删除旧 pending
5. **SSE 通知**: 新增 `log-removed` 事件通知前端删除旧 pending
6. **竞态保护**: 乐观锁防止编辑撤回与 auto-flush 竞态

## 影响范围

- `apps/api/src/db/pending-messages.ts` — upsert/delete/relocate 函数
- `apps/api/src/routes/issues/message.ts` — 使用 upsert
- `apps/api/src/routes/issues/logs.ts` — DELETE pending 端点
- `apps/api/src/engines/issue/lifecycle/turn-completion.ts` — relocate 逻辑
- `apps/api/src/routes/issues/_shared.ts` — flushPendingAsFollowUp + triggerIssueExecution
- `apps/api/src/events/issue-events.ts` — log-removed 事件
- `apps/frontend/src/hooks/use-chat-messages.ts` — pending 置底
- `apps/frontend/src/components/issue-detail/` — 撤回/编辑 UI
- `apps/frontend/src/lib/kanban-api.ts` — delete pending API

## 关联

- plan: PLAN-005
