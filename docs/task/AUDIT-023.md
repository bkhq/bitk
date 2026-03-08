# AUDIT-023 Cache sweep timer 无 shutdown 清理

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Resource Leak

## 位置

- `apps/api/src/cache.ts:31-34`

## 描述

Cache sweep 定时器通过 `setInterval` 创建并 `unref()`，但无 `clearInterval()` 导出，优雅关闭时无法停止。timer closure 持有 cache 引用。

## 修复方向

导出 cleanup 函数供 shutdown handler 调用。
