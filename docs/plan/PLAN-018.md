# PLAN-018 ACP client 按职责拆分重构

- **task**: ENG-009
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- `apps/api/src/engines/executors/acp/acp-client.ts` 当前约 1090 行。
- 该文件混合了协议类型、event sink、subprocess bridge、normalizer state、tool/result 渲染逻辑、protocol handler、spawn/query models 等职责。
- 外部 import 面当前很小，主要是 `executor.ts`、`agents/base.ts` 和 `test/acp-client.test.ts`。

## Proposal

1. 先按职责边界拆成 4 到 5 个内部模块，再让 `acp-client.ts` 退化成稳定出口
   - `types.ts`: `AcpEvent`、normalize state/tool state 等内部类型
   - `transport.ts`: `createEventSink()`、`createSubprocessFromChild()`、child spawn helper
   - `normalizer.ts`: assistant/tool/result/plan/mode 相关归一化逻辑
   - `protocol-handler.ts`: `AcpProtocolHandler`
   - `client.ts` 或保留 `acp-client.ts`: `spawnAcpProcess()`、`queryAcpModels()` 与公共 re-export
2. 保持对外导出 API 尽量不变，避免影响 `executor.ts`、`agents/base.ts` 和现有测试。
3. 优先做“内部模块移动 + barrel re-export”，避免同时改行为和结构。

## Alternatives

1. 只拆 normalizer，其他逻辑仍留在 `acp-client.ts`
   - 优点：改动最小
   - 缺点：文件仍然过大，protocol/transport 继续耦合

2. 按完整职责拆成多个模块，但保持公共出口不变
   - 优点：结构最清晰，外部改动最小
   - 缺点：需要一次性整理内部类型边界

建议采用方案 2。

## Risks

- 如果一口气改动导出接口，容易把结构重构和行为回归耦合在一起。
- Normalizer 的内部状态较多，拆分时如果类型边界不清晰，容易引入循环依赖。

## Scope

- In scope:
  - ACP client 内部模块拆分
  - 导出面稳定化
  - 定向测试与 lint
- Out of scope:
  - ACP 协议行为改动
  - Executor 功能扩展

## Verification

- 现有外部 import 点保持可用
- ACP client 定向测试通过
- ACP 相关 ESLint 通过

## Delivered

- Split ACP internals into `types.ts`, `transport.ts`, `normalizer.ts`, and `protocol-handler.ts`
- Kept `acp-client.ts` as a stable public entrypoint with the same core exports
- Preserved external import sites in `executor.ts`, `agents/base.ts`, and the existing ACP tests
