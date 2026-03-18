# PLAN-026 删除原生 Claude stdout transcript fallback

- **task**: BUG-014
- **status**: completed
- **owner**: codex
- **created**: 2026-03-18

## Context

- 原生 `claude-code` 的 stdout 断裂恢复逻辑来自旧问题 `STALL-001`，核心实现是 transcript JSONL fallback。
- 该逻辑涉及专用模块 `engines/executors/claude/transcript-fallback.ts`、进程注册路径、GC 特判、ManagedProcess 状态字段，以及一个调试路由返回的 transcript 路径。
- 用户已明确该能力不再需要，因此目标是删除整条 fallback 链路，而不是保留开关。

## Proposal

1. 删除 transcript fallback 模块及所有运行时引用。
2. 清理 `ManagedProcess` 上仅为该 fallback 服务的字段与注释。
3. 恢复 stdout 断裂后的统一行为，让原生 Claude 与其他引擎一样进入常规 stall / process exit 处理。
4. 删除调试路由中的 transcriptPath 暴露，避免返回无意义字段。

## Risks

- 如果原生 Claude 未来再次出现 stdout pipe 提前结束问题，将不再尝试从 transcript 自动补齐日志。
- 这会把恢复策略从“补读 transcript”改回“依赖正常 stdout / GC / 退出处理”，属于有意降级以换取更低维护复杂度。

## Scope

- In scope:
  - transcript fallback 运行时代码
  - 相关状态字段、GC 特判、调试接口字段
- Out of scope:
  - 其他引擎的 stdout/stderr 处理
  - 原生 Claude 的基础 spawn/normalizer 协议

## Alternatives

1. 仅保留代码但禁用调用。
优点：改动小。
缺点：保留死代码和额外状态字段，后续仍有维护成本。

2. 完整删除 fallback 链路。
优点：行为更清晰，状态更少。
缺点：失去旧恢复能力。

## Verification

- `bunx eslint apps/api/src/engines/issue/process/register.ts apps/api/src/engines/issue/gc.ts apps/api/src/engines/issue/types.ts apps/api/src/routes/processes.ts apps/frontend/src/components/processes/ProcessList.tsx packages/shared/src/index.ts`
- Attempted `bun test apps/api/test --timeout 20000` but the current environment fails before relevant tests run because `@agentclientprotocol/sdk` is missing
- Attempted `bunx tsc -p apps/frontend/tsconfig.json --noEmit` and `bunx tsc -p apps/api/tsconfig.json --noEmit`; both are blocked by unrelated pre-existing repo TypeScript errors
