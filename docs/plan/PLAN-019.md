# PLAN-019 在 ACP engine 中接入 Claude agent

- **task**: ENG-010
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- 当前 `acp` engine 已支持 `gemini` 与 `codex`，模型 ID 采用 `acp:<agent>:<model>`。
- ACP agent 结构已经拆分为独立文件，新增第三个 agent 的结构成本较低。
- `@zed-industries/claude-code-acp` 是独立 ACP adapter，基于 Claude Code 本地能力运行。

## Proposal

1. 新增 `apps/api/src/engines/executors/acp/agents/claude.ts`
   - `id: 'claude'`
   - `label: 'Claude'`
   - `commandName: 'claude-code-acp'`
   - `npxFallback: ['npx', '-y', '@zed-industries/claude-code-acp']`
   - 复用现有 `verifyAcpCommand()` 与 auth 探测结构
2. 扩展 `AcpAgentId` 联合类型与 registry
3. 保持模型格式不变，Claude 模型将显示为 `acp:claude:<model>`
4. 用现有 `queryAcpModels()` 流程接 Claude 的模型发现，不单独改 executor

## Risks

- Claude ACP adapter 的模型列表、auth 状态和版本检测行为可能与 Gemini/Codex 不完全一致。
- Claude 本地登录态通常不完全由环境变量体现，authStatus 可能只能保守返回 `unknown`。
- 如果当前环境没有安装/登录 Claude Code，本轮只能完成代码接入和可执行验证，未必能完成完整 prompt smoke test。

## Scope

- In scope:
  - Claude ACP agent registry 接入
  - availability/model discovery 接通
  - 定向验证
- Out of scope:
  - 新增 `claude` 独立 engineType
  - ACP 行为改造
  - 前端额外 UI 改动

## Verification

- Claude agent 出现在 `/api/engines/available` 的 `acp` models 中
- ACP 相关 lint / tests 通过
- 如环境允许，补一次最小 smoke test

## Delivered

- Added `claude` to the ACP agent registry using `@zed-industries/claude-code-acp`
- Confirmed runtime availability and model discovery for Claude ACP
- Added probe-result versioning so stale cached discovery data does not hide newly added ACP agents after deploy/restart
