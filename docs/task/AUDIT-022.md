# AUDIT-022 sessionStatus 列无 CHECK 约束和索引

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Database

## 位置

- `apps/api/src/db/schema.ts:68,83-99`

## 描述

`sessionStatus` 列为 text 类型，无 CHECK 约束限制合法值。Reconciler 频繁查询该列但无索引，可能导致全表扫描。

## 修复方向

添加 CHECK 约束限制合法 status 值，为 `sessionStatus` 添加索引。
