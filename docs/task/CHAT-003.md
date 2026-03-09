# CHAT-003 历史消息分页按会话消息计数

- **status**: completed
- **priority**: P1
- **owner**: claude
- **createdAt**: 2026-03-08 20:00

## 描述

"查看更多"历史消息分页目前按所有可见条目（含 tool-use）计数 LIMIT。当工具调用多时，一页 30 条可能大部分是工具消息，用户/助手消息很少。

需求：

- 分页计数只统计 `user-message` 和 `assistant-message`（会话消息）
- 显示时仍包含 tool-use 等所有可见条目
- 即 limit=30 表示 30 条会话消息，附带其间所有工具调用

## 影响范围

- `apps/api/src/engines/issue/persistence/queries.ts` — SQL 分页逻辑
- `apps/api/src/engines/issue/queries.ts` — getLogs 包装函数
- `apps/api/src/engines/issue/engine.ts` — IssueEngine.getLogs 签名
- `apps/api/src/routes/issues/logs.ts` — 路由 hasMore/nextCursor 逻辑

## 关联

- plan: PLAN-004
