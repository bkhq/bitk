# AUDIT-002 Notes 路由无项目作用域和权限检查

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Authorization

## 位置

- `apps/api/src/routes/notes.ts:13-77`

## 描述

Notes API (`GET/POST/PATCH/DELETE /api/notes`) 全局存储，无 `projectId` 关联，无项目归属校验。任何用户可查看、修改、删除所有 notes。在多项目/多用户环境下存在数据泄露风险。

## 修复方向

将 notes 路由移至项目作用域下 `/api/projects/:projectId/notes`，添加项目存在性和归属校验。
