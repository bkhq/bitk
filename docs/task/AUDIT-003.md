# AUDIT-003 回收站全局暴露已删除 issue

- **status**: pending
- **priority**: P0
- **severity**: CRITICAL
- **category**: Authorization

## 位置

- `apps/api/src/routes/settings/recycle-bin.ts:13-105`

## 描述

`GET /api/settings/deleted-issues` 返回所有项目的已删除 issue，无授权检查。`POST /api/settings/deleted-issues/:id/restore` 允许恢复任意项目的已删除 issue，无项目归属验证。

## 修复方向

回收站端点应添加项目作用域过滤，或移至项目路由下。restore 操作需验证项目归属。
