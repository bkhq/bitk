# PLAN-004 GitHub 风格项目文件浏览器

- **task**: FILE-001
- **status**: completed
- **owner**: claude
- **created**: 2026-03-01

## 上下文

项目已有 `filesystem.ts` 路由提供目录浏览（用于项目创建时的目录选择），但缺少项目范围的文件浏览功能。`Project` 类型包含可选的 `directory` 字段，可作为文件浏览器根目录。

现有模式：
- Hono 路由 + zValidator + `{success, data}` 响应包装
- React lazy 页面 + useParams + useProject
- TanStack React Query + queryKeys 工厂
- kanbanApi 客户端方法
- i18n 双语翻译

## 方案

### 后端（2 个新端点）

在 `apps/api/src/routes/` 下新建 `files.ts`，挂载到 `/api/projects/:projectId/files`：

1. **`GET /files?path=`** — 列出目录内容
   - 从 DB 获取项目 → 取 `directory` 字段作为根
   - 无 `directory` → 返回 400
   - `path` 参数为相对路径（默认 `.`），resolve 到项目根
   - 安全检查：resolve 后的绝对路径必须在项目 directory 内
   - 返回：`{ path, entries: [{ name, type: 'file'|'directory', size, modifiedAt }] }`
   - 排序：目录在前、文件在后，各自按名称排序
   - 隐藏 `.` 开头的文件/目录（可选参数 `showHidden`）

2. **`GET /files/content?path=`** — 读取文件内容
   - 同样的项目根 + 路径安全检查
   - 限制文件大小（1MB），超出返回截断提示
   - 检测二进制文件 → 返回提示而非内容
   - 返回：`{ path, content, size, isTruncated, isBinary }`

### 前端

#### 新文件
- `apps/frontend/src/pages/FileBrowserPage.tsx` — 页面容器
- `apps/frontend/src/components/files/FileList.tsx` — 目录列表（GitHub 风格表格）
- `apps/frontend/src/components/files/FileViewer.tsx` — 文件内容查看器
- `apps/frontend/src/components/files/Breadcrumb.tsx` — 面包屑导航

#### 修改文件
- `main.tsx` — 添加 `/projects/:projectId/files` 和 `/projects/:projectId/files/*` 路由
- `kanban-api.ts` — 添加 `listFiles(projectId, path?)` 和 `getFileContent(projectId, path)` 方法
- `use-kanban.ts` — 添加 `queryKeys.projectFiles` 和 `useProjectFiles`、`useFileContent` hooks
- `AppSidebar.tsx` — 在 ViewModeToggle 添加 "文件" 选项
- `view-mode-store.ts` — 添加 `'files'` 视图模式
- `zh.json` / `en.json` — 添加 `fileBrowser` 翻译组

#### UI 设计

目录列表：
```
┌──────────────────────────────────────────────┐
│ 面包屑: project / src / components           │
├──────────────────────────────────────────────┤
│ 📁 ui/                                       │
│ 📁 kanban/                                   │
│ 📄 App.tsx                          1.2 KB   │
│ 📄 main.tsx                         0.8 KB   │
└──────────────────────────────────────────────┘
```

文件内容查看：
```
┌──────────────────────────────────────────────┐
│ 面包屑: project / src / main.tsx             │
│ 157 lines · 4.2 KB                          │
├──────────────────────────────────────────────┤
│ (语法高亮的文件内容，行号)                      │
└──────────────────────────────────────────────┘
```

### 共享类型

在 `packages/shared/src/index.ts` 添加：

```typescript
export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
  size: number
  isTruncated: boolean
  isBinary: boolean
}
```

## 风险

1. **路径遍历安全** — 使用 `resolve()` + `startsWith()` 校验，与现有 `filesystem.ts` 的 `isInsideRoot` 模式一致
2. **大文件** — 1MB 上限 + 截断提示
3. **二进制文件** — 检测并返回友好提示
4. **无 directory 的项目** — 返回 400 + 友好提示引导设置

## 范围

- 12 个文件（4 新建 + 8 修改）
- 不涉及数据库变更
- 不涉及 SSE 事件

## 实现步骤

1. 共享类型定义
2. 后端 files 路由
3. 前端 API 客户端 + hooks
4. FileBrowserPage + 组件
5. 路由注册 + 侧边栏导航
6. i18n 翻译
7. 自验证
