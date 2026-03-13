# PLAN-013 拆分 ACP agent 定义为独立文件

- **task**: ENG-004
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- `apps/api/src/engines/executors/acp/agents.ts` 目前集中定义了 Gemini/Codex 的命令、auth 探测、verify 与模型路由。
- `AcpExecutor` 通过 `./agents` 暴露的函数选择 agent 并查询模型，测试也依赖 `parseAcpModel()`。
- 后续继续接入新的 ACP agent 时，当前单文件结构会持续膨胀，不利于按 agent 维护。

## Proposal

1. 将 ACP agent 公共类型与共享 helper 抽到 `agents/base.ts`。
2. 将 Gemini 与 Codex 各自的定义拆到 `agents/gemini.ts` 与 `agents/codex.ts`。
3. 使用 `agents/index.ts` 暴露现有公共 API，保持 `AcpExecutor` 与测试导入路径不变。
4. 不改外部行为，不改 `model` 解析规则，不改 `/api/engines/available` 响应结构。

## Risks

- 拆分后如果 registry 组装顺序或默认 agent 常量处理不当，可能影响 `parseAcpModel()` 和默认路由。
- 需要避免把共享 helper 分散到各文件后引入循环依赖。

## Scope

- In scope:
  - ACP agent 文件结构重组
  - 保持现有 API 与测试行为一致
- Out of scope:
  - 新增 ACP agent
  - 调整前端模型展示
  - 修改 follow-up `meta: true` 语义

## Alternatives

1. 保持单文件，只在内部用对象分段。
优点：改动最小。
缺点：继续扩 agent 时仍然拥挤。

2. 按 agent 拆分文件，并通过统一入口导出。
优点：结构清晰，便于继续接入 `claude`。
缺点：文件数变多，但复杂度更可控。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/executor.ts src/engines/executors/acp/agents/*.ts test/acp-client.test.ts`
