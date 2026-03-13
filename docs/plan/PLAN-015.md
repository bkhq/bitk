# PLAN-015 ACP plan 与 diff 映射到现有产品 UI

- **task**: ENG-006
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- ACP `plan` update 是协议内标准消息，但当前只映射为 `system-message`，没有进入现有 `task-plan` 组件链路。
- 前端 task-plan 当前主要依赖 `TodoWrite` 的结构化参数。
- ACP `tool_call.content` 已可能携带 `diff` 类型内容；当前后端只做摘要字符串化，未把 patch/compare 信息结构化给前端。
- 前端已有成熟的 diff 渲染组件与工具项展示逻辑，可直接复用。

## Proposal

1. 将 ACP `plan` update 归一化为一个现有产品可识别的计划条目：
   - 优先保持 `entryType: 'tool-use'` + `toolName: 'TodoWrite'` 兼容现有 task-plan
   - 或最小扩展 metadata 让 `use-chat-messages` 能识别 ACP plan
2. 将 ACP `diff` 内容保留为结构化 raw 数据，并补充前端解析：
   - 如果有 unified patch，走现有 patch renderer
   - 如果有 old/new 对比，走 compare renderer
   - 否则回退到摘要/代码块
3. 尽量不新增新的消息类型，复用现有 UI 组件和 shared types。

## Risks

- 如果直接伪装成 `TodoWrite`，语义会有一点兼容层味道，但改动最小。
- ACP diff 内容结构可能和 Codex 现有 patch shape 不完全一致，需要前端 parser 做宽松兼容。
- 需要避免让普通工具卡片和 task-plan/diff 渲染规则互相干扰。

## Scope

- In scope:
  - ACP plan -> task-plan
  - ACP diff -> patch/compare renderer
  - 后端 normalizer 与前端消费链路的最小兼容改造
- Out of scope:
  - 改数据库 schema
  - 改 issue-level git diff API
  - 改非 ACP executor 的渲染逻辑

## Alternatives

1. 为 ACP plan/diff 新增完全独立的消息类型。
优点：语义最纯。
缺点：要动 shared types、前后端 rebuild 和更多组件，成本更高。

2. 复用现有 task-plan 和 diff renderer，只加 ACP 兼容层。
优点：落地快，维护面小，符合现有产品结构。
缺点：会有少量兼容映射逻辑。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/acp-client.ts src/hooks/use-chat-messages.ts src/components/issue-detail/*.tsx test/acp-client.test.ts`
- 手动验证 ACP plan 能显示为 task-plan，ACP diff 能显示为 patch/compare
