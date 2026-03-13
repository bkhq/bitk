# PLAN-017 ACP 前端协议原生时间线重设计

- **task**: ENG-008
- **status**: completed
- **owner**: codex
- **created**: 2026-03-13

## Context

- ACP 接入后，前端展示仍沿用既有日志模型，再通过适配层把协议事件压成 `assistant-message`、`tool-use`、`system-message`、`task-plan` 等旧形态。
- 当前这种方式已经可以工作，但 `plan`、`diff`、`terminal`、`session`、`mode`、`approval` 等协议语义并不是前端一等公民。
- 如果后续继续接入更多 ACP agent，继续在旧模型上打补丁会让适配逻辑和渲染逻辑都越来越脆弱。

## Proposal

1. 定义 ACP 前端专用 view model，不再让前端直接消费旧 `ChatMessage`
   - `assistant_text`
   - `plan`
   - `tool_call`
   - `tool_result`
   - `diff`
   - `terminal_run`
   - `mode_change`
   - `session_event`
   - `system_note`

2. 保持后端日志格式基本稳定，先在前端新增 ACP adapter
   - 新增 `use-acp-timeline.ts`
   - 输入仍是 `NormalizedLogEntry[]`
   - 输出变成 `AcpTimelineItem[]`
   - 这样可以避免第一阶段改动 API schema 或数据库结构

3. 新增 ACP 专用渲染层，而不是重写现有聊天组件
   - 新增 `AcpTimeline.tsx`
   - 新增 `AcpTimelineItem.tsx`
   - `SessionMessages` 根据 `engineType === 'acp'` 切换到新 renderer
   - 非 ACP engine 继续走 `useChatMessages()` + `SessionMessages` 旧链路

4. 首阶段只覆盖最重要的 ACP 一等语义
   - assistant narrative
   - plan card
   - tool call/result card
   - file diff block
   - terminal output block
   - session completion / mode change

5. 第二阶段再考虑提升协议纯度
   - 让 shared types 增加 `AcpTimelineItem`
   - 视情况把 `tool-group` 与 `task-plan` 逐步收敛到 timeline 模型
   - 再决定是否让后端直接返回更协议原生的前端 DTO

## Risks

- 如果直接重写现有聊天消息结构，改动面会过大，容易影响非 ACP engine。
- 如果 view model 设计不稳，后续仍会回到“后端不断 patch，前端继续特判”的状态。

## Scope

- In scope:
  - ACP 前端消息链路调查
  - ACP-native timeline view model 提案
  - 最小可落地兼容方案
- Out of scope:
  - 本轮直接实现完整前端重构
  - 非 ACP engine UI 重写

## Verification

- 现有消息链路与关键组件有明确分析
- 新 view model 与渲染结构有明确提案
- 用户确认后再进入实现阶段

## Implementation Sketch

- Phase 1
  - Add `AcpTimelineItem` types in shared package
  - Add `buildAcpTimeline(logs)` adapter in frontend
  - Add ACP-specific renderer behind `engineType === 'acp'`
- Phase 2
  - Polish approval/mode/session states
  - Improve grouping, collapsing, and timeline density
- Phase 3
  - Evaluate whether the non-ACP UI should converge onto the same timeline abstraction

## Delivered

- Implemented a frontend-local ACP timeline adapter in `apps/frontend/src/hooks/use-acp-timeline.ts`
- Implemented a dedicated ACP renderer in `apps/frontend/src/components/issue-detail/AcpTimeline.tsx`
- Switched `SessionMessages` to route ACP issues into the dedicated renderer while preserving the legacy renderer for non-ACP engines
- Added hook tests to lock ACP plan/tool/message reconstruction behavior
