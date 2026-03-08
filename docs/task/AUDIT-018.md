# AUDIT-018 SPA 静态文件 fallback 不可达

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Bug

## 位置

- `apps/api/src/index.ts:82-101`

## 描述

两个 `serveStatic('*')` 中间件按顺序注册。第一个匹配所有路径并尝试提供静态文件，第二个作为 SPA fallback 返回 `index.html`。但若第一个中间件对不存在的文件返回 404 而非调用 `next()`，则第二个 fallback 永远不会触发，客户端路由无法正常工作。

## 修复方向

验证 Hono `serveStatic` 在文件不存在时是否调用 `next()`，或改用显式 fallback 路由。
