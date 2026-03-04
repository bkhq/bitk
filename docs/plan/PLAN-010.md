# PLAN-010 添加 Notes 笔记功能

- **status**: completed
- **task**: FEAT-006
- **owner**: claude
- **created**: 2026-03-05

## 现状

- AppSidebar 底部区域有：连接状态指示灯、终端按钮、视图切换按钮、设置按钮
- 已有 3 个 Drawer 模式：TerminalDrawer、FileBrowserDrawer、ProcessManagerDrawer
- 每个 Drawer 都有对应的 Zustand store 管理开关状态
- 数据库使用 SQLite + Drizzle ORM，已有 `appSettings` 表可存储简单键值对
- 无现有 notes 相关代码

## 方案

### 数据层（后端）

1. **新增 `notes` 表**（schema.ts）：
   - `id`: ULID 主键
   - `title`: 标题（可选）
   - `content`: 内容（纯文本）
   - `commonFields`: createdAt, updatedAt, isDeleted

2. **新增 API 路由**（`routes/notes.ts`）：
   - `GET /api/notes` — 获取所有笔记（软删除过滤）
   - `POST /api/notes` — 创建笔记
   - `PATCH /api/notes/:id` — 更新笔记
   - `DELETE /api/notes/:id` — 软删除笔记

3. **数据库迁移**：运行 `drizzle-kit generate` 生成迁移文件

### 前端

4. **notes-store.ts**：Zustand store，管理 Drawer 开关状态（参照 terminal-store）

5. **NotesDrawer.tsx**（`components/notes/NotesDrawer.tsx`）：
   - 与 TerminalDrawer 相同的布局风格（header + 可调宽度 + backdrop）
   - 左侧笔记列表 + 右侧编辑区
   - 简洁的 textarea 编辑器，无需 markdown 预览
   - 自动保存（防抖 1s）

6. **API 客户端 + React Query hooks**：
   - `kanban-api.ts` 中添加 notes CRUD 函数
   - `use-notes.ts` 中添加 React Query hooks

7. **AppSidebar.tsx**：终端按钮下方添加笔记按钮（StickyNote 图标）

8. **main.tsx**：添加 NotesDrawerMount 懒加载挂载

9. **i18n**：在 `en.json` 和 `zh.json` 中添加 notes 相关翻译

## 风险

- **低风险**：功能独立，不影响现有系统
- 需要注意自动保存的防抖处理，避免频繁请求

## 范围

| 文件 | 操作 |
|------|------|
| `apps/api/src/db/schema.ts` | 新增 `notes` 表 |
| `apps/api/src/routes/notes.ts` | 新建 — CRUD 路由 |
| `apps/api/src/app.ts` | 挂载 notes 路由 |
| `apps/frontend/src/stores/notes-store.ts` | 新建 — Drawer 状态 |
| `apps/frontend/src/lib/kanban-api.ts` | 添加 notes API 函数 |
| `apps/frontend/src/hooks/use-notes.ts` | 新建 — React Query hooks |
| `apps/frontend/src/components/notes/NotesDrawer.tsx` | 新建 — Drawer 组件 |
| `apps/frontend/src/components/kanban/AppSidebar.tsx` | 添加笔记按钮 |
| `apps/frontend/src/main.tsx` | 添加 NotesDrawerMount |
| `apps/frontend/src/i18n/en.json` | 添加 notes 翻译 |
| `apps/frontend/src/i18n/zh.json` | 添加 notes 翻译 |
| drizzle 迁移文件 | 自动生成 |

## 替代方案

1. **使用 appSettings 表存储**：用一个 JSON blob 存所有笔记 → 不利于查询和并发，放弃
2. **使用 localStorage**：纯前端存储 → 数据不持久、不跨设备，放弃
3. **Markdown 编辑器**：引入 markdown 预览组件 → 增加复杂度和 bundle 大小，初版使用纯文本 textarea
