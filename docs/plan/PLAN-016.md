# PLAN-016 ACP tool result 优先显示格式化输出

- **task**: ENG-007
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- ACP `tool_call_update.rawOutput` 常常包含结构化对象，尤其 unified exec 会返回 `formatted_output`、`stdout`、`aggregated_output`、`stderr` 等字段。
- 当前 `buildAcpToolResultContent()` 直接对整个 `rawOutput` 做 stringify，导致前端工具结果不够可读。
- 前端当前已经优先展示 `item.result.content`，所以最小修复点在后端 ACP result 内容生成处。

## Proposal

1. 在 ACP result 内容生成中增加“可读输出提取”：
   - `formatted_output`
   - `stdout`
   - `aggregated_output`
   - `stderr`
2. 只有在这些字段都没有时，才回退到整段 JSON。
3. 保留原始 `rawOutput` 在 `toolDetail.raw` / metadata 中，不丢结构化信息。

## Risks

- 某些工具的 `formatted_output` 可能已经是摘要文本，和 `content` 重复；但优先级仍应保持 `content` 在前。
- 如果 `stdout` 很长，前端仍可能显示大量文本，不过这比整段 JSON 更符合产品直觉。

## Scope

- In scope:
  - ACP result 正文优先级优化
  - 定向单测补充
- Out of scope:
  - 前端工具组件改造
  - 非 ACP executor

## Alternatives

1. 在前端工具卡片里针对 `output.stdout` 做特判。
优点：不改后端。
缺点：逻辑分散，每类工具组件都可能要补。

2. 在 ACP result 内容生成处统一抽取可读文本。
优点：单点修复，前后端逻辑更干净。
缺点：需要在后端写一层 ACP output 启发式提取。

## Verification

- `bun test --preload ./test/preload.ts test/acp-client.test.ts`
- `bunx eslint src/engines/executors/acp/acp-client.ts test/acp-client.test.ts`
- 运行时确认 ACP command result 优先显示 `formatted_output/stdout`
