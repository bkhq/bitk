# AUDIT-021 软删除不级联到 logs/attachments

- **status**: pending
- **priority**: P3
- **severity**: LOW
- **category**: Data Hygiene

## 位置

- `apps/api/src/routes/projects.ts:293-299`

## 描述

删除项目时，所有 issue 被软删除，但关联的 log entries、attachments、tool calls 未标记删除。虽然查询 logs 时会检查 issue 的 `isDeleted`，但孤儿记录持续占用存储。

## 修复方向

在项目删除事务中级联标记相关 logs、attachments 的 `isDeleted`。
