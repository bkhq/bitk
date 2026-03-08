# AUDIT-008 Logs 端点 limit 参数未经 Zod 验证

- **status**: pending
- **priority**: P1
- **severity**: HIGH
- **category**: Input Validation

## 位置

- `apps/api/src/routes/issues/logs.ts:25-30`

## 描述

`limit` 查询参数使用 `Math.floor(Number(limitParam))` 手动解析，未经 Zod 验证。`Number()` 可解析 `"Infinity"`、`"1e308"` 等极端值，可能导致资源耗尽。`cursor` 和 `before` 参数也未验证 ULID 格式。

## 修复方向

使用 `zValidator('query', ...)` 统一验证，限制 limit 范围（如 1-500），校验 cursor/before 格式。
