# PLAN-020 ACP 时间线恢复工具组展示

- **task**: ENG-011
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- ACP renderer 当前已经独立，但每个 tool action/result 都作为单独时间线项显示。
- 产品上更合适的主单元仍然是工具组，这样能保持阅读一致性、降低视觉碎片，并继续复用现有成熟的 `ToolGroupMessage` UI。
- 非工具语义如 `plan`、`assistant`、`mode`、`session` 仍应保留独立展示。

## Proposal

1. 调整 `useAcpTimeline()`，把连续工具项重建为 `tool-group`
2. 保留 `plan`、`entry`、`pendingMessages` 现有结构
3. `AcpTimeline.tsx` 改为直接复用 `ToolGroupMessage`
4. 补测试锁定“连续工具项 -> 单个工具组”的行为

## Risks

- 如果 grouping 规则过于激进，可能把本应拆开的工具片段并到一起。
- 需要确保 `plan` 或普通消息仍然能正确打断工具组。

## Scope

- In scope:
  - ACP adapter/tool grouping
  - ACP renderer 调整
  - 定向测试与 lint
- Out of scope:
  - 非 ACP renderer 改造
  - 后端日志结构变更

## Verification

- 连续工具条目会聚合为单个工具组
- 非工具语义仍独立显示
- 前端定向 tests / lint 通过

## Delivered

- Updated the ACP adapter to buffer consecutive tool entries into one `tool-group`
- Switched the ACP renderer to reuse the existing `ToolGroupMessage` component
- Added tests to lock contiguous tool-call grouping behavior
