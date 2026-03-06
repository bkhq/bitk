# PLAN-011 Pending 消息消费后的前后端同步修复

- status: completed
- task: BUG-091
- owner: codex
- createdAt: 2026-03-06 19:15 UTC
- updatedAt: 2026-03-06 19:50 UTC

## Context
当前 pending 消息在后端被消费时，会走 `followUpIssue(..., { skipPersistMessage: true })`，随后通过 `promotePendingMessages()` 将原有日志行从 `metadata.type='pending'` 提升为普通 user-message。前端 `useIssueStream()` 是 append-only，并按 `messageId` 去重，无法把同一条消息 ID 的本地 pending 项就地覆盖，因此 UI 会一直显示 pending，直到页面刷新后重新拉取日志快照。

## Proposal
新增显式的“日志更新”事件：后端在 pending 消息被 promote 后按 messageId 发出更新事件，前端 SSE/EventBus 接收后，在 `useIssueStream()` 中按 `messageId` 对已有日志项做 upsert/replace，从而立即移除 pending 标记并保留既有顺序与去重语义。

## Risks
- 共享事件类型扩展后，前后端事件名和载荷必须保持完全一致，否则会出现静默丢事件。
- 前端本地 upsert 需要避免破坏现有 `seenIdsRef` / 排序 / 去重逻辑。
- 后端 promote 是批量 best-effort 路径，发事件时要基于最终写入成功的内容，避免前端与 DB 再次分叉。
- 已完成 `bun install`，前后端聚焦测试均通过。
- 后端测试阻塞的真实原因是当前 worktree 的 `drizzle-orm` 安装产物残缺，而非版本本身有问题；定向重装该包后问题消失。
- 已处理 review 指出的首帧快照与 `log-updated` 事件竞态，新增测试覆盖“先收到 SSE 更新、后收到陈旧快照”的场景。

## Scope
- 扩展共享 SSE/App event 类型与后端事件辅助函数
- 在 pending promote 路径发出日志更新事件
- 在前端 EventBus 与 `useIssueStream()` 中消费并覆盖已有日志项
- 补充针对 pending 转正同步的回归测试

## Alternatives
- 前端定向重拉日志：改动小，但仍有竞态窗口，且缺乏明确语义
- 复用现有 `issue-updated`：可以承载额外字段，但事件职责会继续膨胀，不如单独 `log-updated` 清晰
