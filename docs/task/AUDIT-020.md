# AUDIT-020 Issues 列表无分页 limit

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Performance

## 位置

- `apps/api/src/routes/issues/query.ts:34-38`

## 描述

Issues 列表查询无 `.limit()` 限制，大量数据时可导致响应过大或 OOM。

## 修复方向

添加分页参数（limit/offset 或 cursor），设置合理默认上限。
