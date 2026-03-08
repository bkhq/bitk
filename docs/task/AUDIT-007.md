# AUDIT-007 Reconciler 与 spawn 竞态

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Race Condition

## 位置

- `apps/api/src/engines/reconciler.ts:69-84`

## 描述

`hasActiveProcess()` 检查与 DB 更新之间存在时间窗口，期间新进程可被 spawn。Reconciler 可能将正在运行的 issue 错误标记为 review，导致 DB 状态 (`statusId='review'`) 与 PM 状态 (`running`) 不一致。Reconciler 每 60 秒运行一次，窗口虽短但存在。

## 修复方向

Reconciler 操作应持有 issue lock，或在 DB 更新时使用乐观锁检查 `statusId` 未变。
