# FEAT-002 将 SERVER_NAME 和 SERVER_URL 从环境变量迁移到数据库

- **status**: completed
- **priority**: P2
- **owner**: claude
- **created**: 2026-03-08

## 描述

将 `SERVER_NAME` 和 `SERVER_URL` 的存储从环境变量迁移到 `appSettings` 数据库表，通过 settings API 进行读写，支持运行时修改无需重启服务。

## 涉及文件

- `apps/api/src/routes/settings/about.ts` — system-info 改为从 DB 读取
- `apps/api/src/routes/settings/general.ts` — 新增 GET/PATCH server-info 端点
- `apps/api/src/webhooks/dispatcher.ts` — 改为从 DB 读取 SERVER_URL
- `apps/api/src/routes/issues/create.ts` — 改为从 DB 读取 SERVER_URL
- `apps/api/src/routes/issues/delete.ts` — 改为从 DB 读取 SERVER_URL
- `apps/api/src/db/helpers.ts` — 新增 server info helper 函数
- `apps/frontend/src/lib/kanban-api.ts` — 新增 updateServerInfo API
- `apps/frontend/src/hooks/use-kanban.ts` — 新增 useUpdateServerInfo hook
- 前端设置页面 — 添加 server name/url 编辑 UI
