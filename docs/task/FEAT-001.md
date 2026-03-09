# FEAT-001 添加 server_name 和 server_url 环境变量

- **status**: completed
- **priority**: P2
- **owner**:
- **created**: 2026-03-08

## 描述

从环境变量读取 `SERVER_NAME` 和 `SERVER_URL`，通过 API 暴露给前端：

- `SERVER_NAME` 显示在页面标题上
- `SERVER_URL` 用于拼接外部 URL（复制链接、webhook payload 等场景）

## 涉及文件

- `apps/api/.env.example` — 添加新环境变量说明
- `apps/api/src/routes/settings/about.ts` — system-info 接口增加 server 字段
- `apps/frontend/src/lib/kanban-api.ts` — 更新 getSystemInfo 类型
- `apps/frontend/src/hooks/use-kanban.ts` — useSystemInfo 已存在，类型跟随
- `apps/frontend/src/App.tsx` 或 `main.tsx` — 动态设置 document.title
- `apps/frontend/src/components/issue-detail/ChatArea.tsx` — copyLink 使用 server_url
- `apps/frontend/src/components/kanban/IssuePanel.tsx` — copyLink 使用 server_url
- `apps/api/src/webhooks/dispatcher.ts` — webhook payload 中添加 issueUrl
