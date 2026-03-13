# PLAN-009 ACP SDK 接入并实现独立 ACP executor

- **task**: ENG-002
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- 现有仓库已经具备 session 型 engine 的上层抽象，包括 `externalSessionId`、运行中 follow-up 与 `sendUserMessage()`。
- 现有 Claude executor 走 `stream-json` + 自定义控制协议，核心握手在 `apps/api/src/engines/executors/claude/executor.ts` 和 `apps/api/src/engines/executors/claude/protocol.ts`，并未复用 ACP。
- `docs/architecture.md` 原先将 `claude-code` 标为 `stream-json`、`gemini` 标为 `acp`，说明 ACP 尚未进入通用 executor 层。
- 本次调查目标是评估是否可以基于 `@agentclientprotocol/sdk` 增加一个可运行的 ACP client，并先验证 Claude ACP 适配，再在仓库内落为独立 `acp` engine。
- 外部验证结果：
  - `@agentclientprotocol/sdk@0.16.1` 提供 `ClientSideConnection`、`ndJsonStream` 与示例 client，最小调用链为 `initialize -> newSession -> prompt`
  - `@zed-industries/claude-agent-acp@0.21.0` 提供 `claude-agent-acp` 二进制入口，内部基于 `@anthropic-ai/claude-agent-sdk`
  - 本机 smoke test 已成功完成 `initialize` 与 `newSession`；`prompt` 失败原因为 Claude 账户额度限制，而非 ACP 握手或 transport 异常
  - `claude-agent-acp` 支持会话能力 `list` / `resume` / `fork`，与仓库现有 `externalSessionId` 抽象相容性较高

## Proposal

分两步推进：

1. 新增一个独立的 ACP client 层，封装 stdio transport、ACP 初始化、session 创建、prompt 发送、session update 事件转流。
2. 将 ACP 暴露为独立 `engineType: 'acp'` 的 executor；当前默认 agent 先落在 Gemini CLI，上层不再感知 `gemini`。

PoC 目标：

- 可以发现默认 ACP agent 的可用性与模型列表
- 可以建立 ACP session，并把 `sessionUpdate` 流映射为现有 `NormalizedLogEntry`
- 可以在运行中 follow-up，并把 ACP `sessionId` 写入现有 `externalSessionId`
- 在额度不足或认证缺失时，给出明确错误和降级行为

实现策略上优先复用现有 Codex / issue follow-up 机制，不优先复用现有 Claude protocol handler。

## Risks

- `claude-agent-acp` 依赖 Claude Agent SDK，语义和事件模型与当前 `claude-code` stream-json 不同，日志归一化需要重新设计。
- 当前机器在 2026-03-13 的 Claude ACP smoke test 中已触发账户额度限制；仓库内最终落地的默认 ACP agent 为 Gemini CLI，后续切换 Claude 或 Codex ACP 仍需单独验证。
- ACP 是双向协议，除消息流外还可能触发权限请求、文件读写、terminal、MCP 等 client 回调；PoC 若只覆盖最小 prompt，需要明确禁用或兜底这些能力。
- 若继续把 ACP 绑定在某个供应商 executor 名下，后续接入 Claude 或 Codex ACP 会重复改路由、设置与前端映射。

## Scope

- In scope:
  - 设计并接入一个最小 ACP client 封装
  - 新增独立 `acp` executor，并以 Gemini CLI 作为当前默认 ACP agent
  - 打通 `initialize` / `newSession` / `prompt` / follow-up / cancel 的服务端链路
  - 对 `sessionUpdate` 做最小可用日志映射
- Out of scope:
  - 替换现有 `claude-code` stream-json executor
  - 一次性兼容 ACP 全量能力（terminal、edit review、MCP、图片等）
  - 在同一轮里把 Gemini 也完整迁移到 ACP

## Alternatives

1. 直接扩展现有 `gemini` executor 为通用 ACP executor。
优点：可以复用现有 `protocol: 'acp'` 入口。
缺点：会把协议层和供应商命名耦合在一起，后续接更多 ACP agent 时仍要二次拆分。

2. 直接把当前 `claude-code` executor 改为走 ACP。
优点：用户表面上仍只有一个 Claude 引擎。
缺点：会把两套不同后端实现混成一个 executor，回归面最大，也最难排查问题。

3. 新增独立 `acp` executor。
优点：协议边界最清晰，后续接 Claude 或 Codex ACP 只需替换底层 agent 命令。
缺点：需要单独处理旧 `gemini` 配置与数据兼容。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/executor.ts src/engines/executors/acp/acp-client.ts test/acp-client.test.ts`
- 运行时 smoke test：`AcpExecutor.spawn()` 成功返回 `thinking -> assistant-message(PONG) -> turnCompleted`
