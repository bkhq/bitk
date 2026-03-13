# PLAN-011 模型发现链路缺少可诊断日志

- **task**: BUG-009
- **status**: implementing
- **owner**: codex
- **created**: 2026-03-13

## Context

- `/api/engines/available` 的数据来自 `startup-probe.ts` 的 `runLiveProbe()`。
- 当前 probe 只在 engine 级别记录 `probe_engine_done` 和 `probe_engine_failed`，缺少 models 子步骤的失败原因。
- ACP executor 内部又会继续 fan-out 到 Gemini/Codex 多个 agent；其中 `getModels()` 当前把失败 agent 静默丢弃，外层只能看到 `acp` 模型数变少。
- 因此当用户反馈“模型支持没有返回”时，现有日志无法区分是缓存问题、availability 成功但 models 失败、还是某个 ACP agent 单独失败。

## Proposal

增加最小但可追踪的 debug log，不改行为：

1. 在 `AcpExecutor.getModels()` 中为每个 agent 记录模型发现成功/失败日志。
2. 在 `queryScopedAcpModels()` 成功时记录 agent、模型数、默认模型，失败由调用方补充上下文。
3. 在 `startup-probe.ts` 中拆开 availability 和 models 的结果记录，至少对 models 失败单独打 warn/debug。
4. 保持 `/api/engines/available` 的响应格式不变，只增强服务端日志。

## Risks

- 启动日志会变多，但只在 probe 路径输出，量可控。
- 如果日志级别选择不当，生产信息噪音会上升；需要优先用 `debug`，失败用 `warn`。

## Scope

- In scope:
  - engine 级与 ACP agent 级模型发现日志
  - 启动 probe 与直接 `getModels()` 调用路径
- Out of scope:
  - 修改模型发现缓存结构
  - 修改前端展示
  - 修改 API 响应 schema

## Alternatives

1. 只在路由层打印最终响应。
优点：改动小。
缺点：拿不到 agent 级失败原因，诊断价值不足。

2. 在 probe 和 ACP agent 两层都加日志。
优点：能定位到 engine -> agent -> model discovery 三层。
缺点：日志点更多，但仍可控。

## Verification

- `bunx eslint apps/api/src/engines/startup-probe.ts apps/api/src/engines/executors/acp/executor.ts apps/api/src/engines/executors/acp/agents.ts`
- 启动 API 后触发 `/api/engines/available`，确认日志中包含 agent 级模型发现结果
