# PIPE-001 Claude executor 替换 Bun.spawn 为 node:child_process

- **status**: completed
- **priority**: P0
- **owner**: claude
- **created**: 2026-03-09

## Context

Bun.spawn 的 stdout pipe 在某些情况下会意外断裂（Bun pipe bug），导致：
1. 进程仍在运行（stdin 保持打开），但 BKD 无法读取 stdout
2. Transcript fallback 接管但无法检测 turn 完成（10 分钟后超时）
3. `subprocess.exited` 永远不 resolve → 不触发 settlement → 前端卡在 "thinking"
4. 用户发的 follow-up 消息以 `followup_queued_during_active_turn` 排队，无法执行

## Solution

混合方案：仅 claude executor 替换为 node:child_process.spawn，其他 executor 保持 Bun.spawn。

## Files

- `apps/api/src/engines/spawn.ts` — 新文件，node:child_process 包装器
- `apps/api/src/engines/executors/claude/executor.ts` — 使用包装器
- `apps/api/src/engines/executors/claude/protocol.ts` — stdin 类型适配
