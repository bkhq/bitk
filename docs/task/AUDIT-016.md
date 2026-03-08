# AUDIT-016 SSE 订阅部分创建后泄漏

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Resource Leak

## 位置

- `apps/api/src/routes/events.ts:45-92`

## 描述

SSE 端点按顺序创建多个 `appEvents.on()` 订阅。若中途某个订阅调用抛出异常，已创建的订阅不会被 finally 块正确清理（后续变量为 undefined，调用时跳过或报错）。

## 修复方向

将所有订阅存入数组，finally 中遍历数组统一取消订阅。
