# FILE-001 添加 GitHub 风格的项目文件浏览器

- **priority**: P1
- **status**: completed
- **owner**: claude
- **plan**: PLAN-004
- **created**: 2026-03-01

## 描述

为项目添加文件浏览器功能，通过 `/projects/:projectId/files` 路径查看项目文件。类似 GitHub 的文件浏览体验，支持目录导航、文件内容查看、面包屑导航。不涉及数据库，纯文件系统读取，基于项目的 `directory` 字段作为根目录。

## 验收标准

- [x] 后端: `GET /api/projects/:projectId/files` 返回目录列表（文件+文件夹）
- [x] 后端: `GET /api/projects/:projectId/files/content` 返回文件内容
- [x] 后端: 路径遍历安全防护（限制在项目 directory 内）
- [x] 前端: `/projects/:projectId/files` 路由可访问
- [x] 前端: GitHub 风格目录列表（图标区分文件/文件夹，点击导航）
- [x] 前端: 面包屑导航
- [x] 前端: 文件内容查看（带语法高亮）
- [x] 前端: 侧边栏导航入口
- [x] i18n: 中英文翻译完整
