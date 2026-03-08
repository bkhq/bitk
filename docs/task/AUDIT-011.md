# AUDIT-011 consumeStderr reader lock 未释放

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Resource Leak

## 位置

- `apps/api/src/engines/issue/streams/consumer.ts:172-173`

## 描述

`consumeStderr()` 中 `getManaged()` 返回 undefined 时 early return，但 reader lock 未调用 `releaseLock()`（仅在 finally 块 line 202 释放）。若 PM 在 stderr 读取期间移除条目，reader lock 将永久持有。

## 修复方向

将 early return 移到 try 块内，确保 finally 中 `releaseLock()` 总是被调用。
