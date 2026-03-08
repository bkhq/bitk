# AUDIT-017 数据库迁移错误匹配正则脆弱

- **status**: pending
- **priority**: P2
- **severity**: MEDIUM
- **category**: Reliability

## 位置

- `apps/api/src/db/index.ts:41-56`

## 描述

迁移错误处理通过正则匹配 SQLite 错误消息文本 (`/^(table|index) "?.+"? already exists$/im`) 来静默"已存在"错误。该正则依赖特定 SQLite/Drizzle 版本的错误文本格式，版本更新可能导致误判：要么放过真正的错误，要么阻止合法迁移。

## 修复方向

使用 SQLite 错误码（如 SQLITE_ERROR + 特定 result code）替代文本匹配。
