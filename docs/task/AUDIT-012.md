# AUDIT-012 finishedAt 时间戳竞态

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Race Condition

## 位置

- `apps/api/src/engines/process-manager.ts:189,230,378`

## 描述

`terminate()`、`forceKill()` 和 `monitorExit()` 多处通过 `if (!entry.finishedAt)` 检查后设置时间戳，但非原子操作。并发调用可导致设置不同 `Date` 对象，影响依赖 `finishedAt` 的 GC 逻辑。

## 修复方向

在状态机 transition 中统一设置 `finishedAt`，确保仅在首次 terminal 转换时赋值。
