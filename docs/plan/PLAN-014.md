# PLAN-014 ACP tool call 消息按文档配对到产品状态

- **task**: ENG-005
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- ACP 官方类型定义里，`tool_call` 是工具调用创建事件，`tool_call_update` 是对同一 `toolCallId` 的增量更新，可携带 `status`、`rawOutput`、`content`、`locations` 等结果信息。
- ACP 协议文档明确说明 prompt turn 中，Agent 通过 `session/update` 连续上报 `tool_call` 与 `tool_call_update`，turn 最终再由 `session/prompt` 响应结束。
- ACP `tool-calls` 文档明确 `title` 是 required 的人类可读标题，`kind` 是可选工具类别，`status` 生命周期为 `pending` / `in_progress` / `completed` / `failed`。
- 文档示例明确 `tool_call_update` 可在 `completed` 时携带 `content`，并且 `rawInput` / `rawOutput` 是工具输入输出的原始对象。
- 当前 ACP normalizer 没有维护 `toolCallId -> tool state` 的状态，也没有生成 `isResult: true` 的结果条目，因此现有前后端配对逻辑无法生效。
- 现有产品侧的 tool group 依赖 `toolCallId`、`toolDetail.isResult`、`toolDetail.kind`、`toolAction` 等字段，Claude executor 已是参考实现。

## Proposal

1. 在 ACP normalizer 中维护 `toolCallId -> tool state`，记录最近的 `title`、`kind`、`rawInput`、`rawOutput`、`content`、`locations`、`status`。
2. `tool_call` 产生 action entry：
   - `entryType: 'tool-use'`
   - `isResult: false`
   - 带 `toolCallId`
   - 尽可能补齐 `toolAction` / `toolDetail.raw`
3. `tool_call_update` 在出现结果信号时产生 result entry：
   - 条件以文档字段为准：`rawOutput`、`content`、或状态进入 `completed` / `failed`
   - `isResult: true`
   - 继续沿用同一 `toolCallId`
4. 对没有真实工具名的 ACP 事件，用 `title` 作为展示名落库；`kind` 用 ACP 官方枚举映射到现有产品的 `kind` / `toolAction`。
5. 保持现有 assistant streaming 修复不变，不改前端 message rebuild 逻辑。

## Risks

- ACP 没有独立 `toolName` 字段，`title` 是展示名，不一定稳定；这会影响工具名统计，但比空值更适合产品显示。
- `tool_call_update` 是增量事件，如果状态机设计不严谨，可能重复产出 result entry。
- `rawOutput` / `content` 结构可能跨 agent 有差异，需要用保守序列化策略。

## Scope

- In scope:
  - ACP tool action/result 配对
  - `toolAction` / `toolDetail` 最小可用补全
  - 覆盖 `gemini` / `codex` ACP 路径
- Out of scope:
  - 修改前端 tool group 组件结构
  - 引入新的数据库表或 schema
  - 处理非 ACP executor

## Alternatives

1. 继续把 `tool_call_update` 当普通状态文本。
优点：改动小。
缺点：前后端无法配对，产品体验仍然不完整。

2. 按文档维护 tool state，并在结果信号时补 result entry。
优点：复用现有产品配对链路，和 Claude 语义一致。
缺点：需要引入 ACP normalizer 状态机。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/acp-client.ts test/acp-client.test.ts`
- 运行一次 ACP tool call，确认 action/result 在日志中成对出现
