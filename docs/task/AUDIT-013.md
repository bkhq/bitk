# AUDIT-013 parentId 查询参数未验证

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Input Validation

## 位置

- `apps/api/src/routes/issues/query.ts:19-31`

## 描述

`parentId` 查询参数直接从 `c.req.query()` 获取并用于 WHERE 子句，未经 Zod 验证。无父 issue 存在性检查，无同项目归属校验（虽然 DB 过滤防止跨项目泄漏）。允许探测不存在的 issue ID。

## 修复方向

使用 `zValidator('query', ...)` 验证 parentId 格式，并检查父 issue 存在且属于同项目。
