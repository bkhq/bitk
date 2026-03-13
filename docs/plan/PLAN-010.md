# PLAN-010 ACP engine 支持基于 model 的多 agent 路由

- **task**: ENG-003
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- 当前 `acp` engine 已经能通过 `@agentclientprotocol/sdk` 驱动单一 ACP agent，并完成 `initialize`、`newSession`、`prompt`、follow-up 与日志归一化。
- 现有数据库 schema 中 `issues.model`、默认模型设置和 webhook/log 展示都以普通字符串存储模型，不依赖结构化字段。
- 当前实现仍将 ACP 默认 agent 固定为 Gemini CLI；若继续新增 `acp-gemini`、`acp-codex`、`acp-claude` 这类 engineType，会扩大路由、设置和前端枚举的改动面。
- `@zed-industries/codex-acp@0.9.5` 提供 ACP adapter，可通过 `npx @zed-industries/codex-acp` 启动，支持 ChatGPT 订阅、`CODEX_API_KEY`、`OPENAI_API_KEY` 等认证方式。

## Proposal

采用单一 `acp` engine + 复合 model 标识方案：

1. 约定 ACP 模型 ID 格式为 `acp:<agent>:<model>`。
2. 在 `AcpExecutor` 内解析 model ID，根据 `<agent>` 选择底层 ACP agent 配置。
3. `getModels()` 聚合所有已安装 ACP agent 的模型列表，并返回带前缀的模型 ID。
4. 保留现有数据库结构，只调整 model 校验、显示名称和执行时的解析逻辑。

首批 agent：

- `gemini` -> `@google/gemini-cli --acp`
- `codex` -> `@zed-industries/codex-acp`

## Risks

- 不同 ACP agent 的 session 恢复、权限请求与 model API 细节可能不完全一致，需要为解析和降级留出兜底。
- `getAvailability()` 目前是 engine 级，而不是 agent 级；若 UI 需要展示 ACP 下的子 agent 状态，可能还需要后续扩展 metadata。
- `codex-acp` 的认证状态比 Gemini 更复杂，若只做最小探测，authStatus 需要保守处理。

## Scope

- In scope:
  - 定义并解析 `acp:<agent>:<model>`
  - 接入 Gemini 与 Codex 两个 ACP agent
  - 聚合模型列表并支持执行时按 model 路由
  - 更新前后端校验与显示逻辑
- Out of scope:
  - 新增数据库列或迁移
  - 同一轮接入 Claude ACP
  - 重构现有非 ACP engine

## Alternatives

1. 为每个 ACP agent 定义一个新的 engineType。
优点：availability 与设置天然隔离。
缺点：需要修改数据库、路由、前端枚举和默认设置，改动面更大。

2. 在 `engineType=acp` 下，用额外数据库字段保存 agent。
优点：语义更结构化。
缺点：需要 schema 迁移，和现有 model/defaultModel 机制重复。

3. 在 `engineType=acp` 下，用 `model` 承载 agent 前缀。
优点：不改 schema，兼容当前执行与设置流程。
缺点：需要额外的解析和展示逻辑。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/executor.ts src/engines/executors/acp/acp-client.ts test/acp-client.test.ts`
- Gemini ACP smoke test：成功返回 `assistant-message` 和 `turnCompleted`
- Codex ACP smoke test：若环境具备可用认证，成功返回 `assistant-message` 和 `turnCompleted`
