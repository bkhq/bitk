# AUDIT-026 SSE writeSSE 序列化失败无日志

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Observability

## 位置

- `apps/api/src/routes/events.ts:37-40`

## 描述

`writeEvent()` 中 `JSON.stringify()` 若因循环引用失败，`.catch(stop)` 静默终止流，无日志记录。无法排查 SSE 连接意外关闭的原因。

## 修复方向

在 catch 中添加错误日志。
