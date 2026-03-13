# PLAN-022 修复 ACP tool result 重复渲染

- **task**: BUG-011
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- 问题根因位于 ACP normalizer，而不是前端 timeline。
- 数据库日志显示，同一个 `toolCallId` 会先落一条泛化 action，再落一条具体 action，例如：
  - `Read File` -> `file-read(path=...)`
  - `Terminal` -> `command-run(command=...)`
- 这导致前端虽然按现有工具组逻辑正常展示，但看到的仍是重复工具项。

## Proposal

1. 调整 ACP normalizer 的 action 发射策略
2. 对同一个 `toolCallId`，只在拿到足够具体的信息后发射一次 action
3. 保留 result 发射逻辑不变
4. 补测试锁定“占位工具 -> 具体工具”不会重复

## Risks

- 如果 action 发射条件过严，某些合法但缺少结构化参数的工具可能只剩 result 展示。
- 需要确保现有 result 发射与 turn completion flush 不受影响。

## Scope

- In scope:
  - ACP normalizer action de-dup
  - ACP 定向测试
  - lint
- Out of scope:
  - 历史日志回写修复
  - 非 ACP executor 改造

## Verification

- 同一个 `toolCallId` 不再重复落 action
- 现有 ACP tool result 仍正常输出
- `acp-client.test.ts` / eslint 通过

## Delivered

- Delayed ACP action emission until the tool call contains concrete path/command/query data
- Ensured each `toolCallId` emits at most one action entry
- Added a regression test covering placeholder `Read File` followed by specialized `file-read`
