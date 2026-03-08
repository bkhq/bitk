# CRASH-002 修复永久卡死根本原因

- **status**: completed
- **priority**: P0
- **owner**: claude
- **created**: 2026-03-08

## 背景

CRASH-001 添加了崩溃检测日志后，通过日志分析发现了导致前端永久卡在 "working" 状态的根本原因。问题分为 4 个子项。

## 目标

修复 4 个导致永久卡死的根因，缩短 stall 检测总时间从 10 分钟降至 6 分钟。

## 变更文件

- `apps/api/src/engines/issue/gc.ts`
- `apps/api/src/engines/issue/lifecycle/turn-completion.ts`
- `apps/api/src/engines/issue/process/lock.ts`
- `apps/api/src/engines/issue/constants.ts`
