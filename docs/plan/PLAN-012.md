# PLAN-012 ACP streaming assistant message 收尾落地

- **task**: BUG-010
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- `apps/api/src/engines/executors/acp/acp-client.ts` 目前只把 `agent_message_chunk` 转成 streaming assistant delta，没有生成最终的完整 assistant message。
- `apps/api/src/engines/issue/pipeline/persist.ts` 与 `apps/api/src/routes/events.ts` 都跳过 `streaming` 条目，因此 ACP assistant delta 既不会持久化，也不会通过普通 `log` SSE 发给前端。
- `apps/frontend/src/hooks/use-chat-messages.ts` 对 `assistant-message` 本身没有额外过滤；只要后端给出非隐藏的 assistant entry，前端就会显示。
- 因此问题核心不在前端，而在 ACP executor 缺少 “收集 chunk 并在 turn 结束时发出最终 assistant-message” 的桥接逻辑。

## Proposal

1. 在 ACP client 内维护当前 turn 的 assistant text buffer，累积 `agent_message_chunk` 文本内容。
2. 在 `acp-prompt-result` 归一化时，如 buffer 非空，先发出一个非 streaming 的 `assistant-message`，再发 turn completed system-message。
3. 清理每轮 prompt 的 assistant buffer，避免跨 turn 污染；follow-up/loadSession 也走同一逻辑。
4. 保持现有 streaming debug/raw log 不变，最小化修改现有 pipeline 和前端。

## Risks

- 不同 ACP agent 可能发送非文本 chunk；需要只拼接文本，避免把附件/结构化内容错误串接成回复。
- 如果某些 agent 将来已经返回最终完整消息，重复生成 assistant message 会导致双写；实现时需要以当前 ACP 事件模型为准并保持行为单一。

## Scope

- In scope:
  - ACP assistant chunk 聚合与最终 assistant message 落地
  - `acp:codex:*` 与 `acp:gemini:*` 共用修复
- Out of scope:
  - 改写前端聊天重建逻辑
  - 改写 SSE 对 streaming 条目的通用策略
  - 扩展 ACP 多模态内容展示

## Alternatives

1. 让 SSE 直接把 streaming `log` 发给前端。
优点：能实时显示 chunk。
缺点：会影响全局事件约定，还要补前端 delta 合并，改动面更大。

2. 在 ACP client 结束时补一条最终 assistant message。
优点：改动集中在 ACP executor，兼容现有 DB/SSE/前端链路。
缺点：实时性仍依赖 turn 结束时落地。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint apps/api/src/engines/executors/acp/acp-client.ts`
- 手动触发一次 ACP follow-up，确认前端出现 assistant 回复
