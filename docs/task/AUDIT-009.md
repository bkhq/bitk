# AUDIT-009 子进程 exited Promise 无超时

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Resource Leak

## 位置

- `apps/api/src/engines/process-manager.ts:368-390`

## 描述

`monitorExit()` 中 `subprocess.exited` promise 链无超时。若子进程变为僵尸状态（OS 层面），promise 永不 settle，handler 永不触发。虽然 PM 的 auto-cleanup（5 分钟）会移除条目，但 `monitorExit` 仍持有 subprocess promise 引用，长期运行可累积内存泄漏。

## 修复方向

为 `subprocess.exited` 添加 `Promise.race` 超时（如 10 分钟），超时后强制 kill 并转为 failed 状态。
