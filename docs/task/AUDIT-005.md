# AUDIT-005 Engine 领域数据内存泄漏

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Memory Leak

## 位置

- `apps/api/src/engines/issue/engine.ts:99-109`

## 描述

PM `onStateChange()` 回调为空（仅含注释）。当 ProcessManager 5 分钟后自动清理条目时，`entryCounters` 和 `turnIndexes` 中的对应数据不会被清除。虽然 GC sweep 每 60 秒运行一次可兜底清理，但在此窗口期内数据持续积累。长期运行的高吞吐服务器上问题尤为明显。

## 修复方向

在 `onStateChange` 回调中当状态转为 terminal 时调用 `cleanupDomainData()`。
