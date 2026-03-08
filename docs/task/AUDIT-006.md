# AUDIT-006 Reconciler 检查范围过窄

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: State Management

## 位置

- `apps/api/src/engines/reconciler.ts:28-97`

## 描述

Reconciler 仅检查 PM 中的活跃进程 (`hasActiveProcess`)。若 PM 条目已被 GC 自动清理（5 分钟后）但 `monitorCompletion()` 未正常完成，DB 仍显示 `sessionStatus='running'` 和 `statusId='working'` 的 issue 不会被移至 review。

## 修复方向

Reconciler 应同时检查 DB 中 `sessionStatus='running'` 但 PM 中无对应条目的 issue，将其标记为 failed/review。
