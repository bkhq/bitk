# PLAN-004 将 SERVER_NAME 和 SERVER_URL 从环境变量迁移到数据库

- **status**: completed
- **task**: FEAT-002
- **owner**: —
- **created**: 2026-03-08

## 背景

当前 `SERVER_NAME` 和 `SERVER_URL` 通过环境变量配置，修改后需要重启服务。迁移到 `appSettings` 表后可在运行时通过 UI 修改。

## 调查结果

### 当前使用位置（后端 4 处读取 `process.env`）

1. **`routes/settings/about.ts`** — `GET /api/settings/system-info` 返回 `server.name` / `server.url`
2. **`webhooks/dispatcher.ts`** — `getIssueMetadata()` 用 `SERVER_URL` 构建 `issueUrl`
3. **`routes/issues/create.ts`** — issue 创建后 webhook payload 注入 `issueUrl`
4. **`routes/issues/delete.ts`** — issue 删除后 webhook payload 注入 `issueUrl`

### 前端消费方式

- `main.tsx` 的 `ServerConfigLoader` 组件从 `/api/settings/system-info` 获取 server info → Zustand `server-store`
- `server-store.ts` 的 `getIssueUrl()` 已使用 `window.location.origin`（不依赖 SERVER_URL）
- `IssuePanel.tsx` / `ChatArea.tsx` 调用 `getIssueUrl()` 复制链接

### 现有 appSettings 模式

`db/helpers.ts` 已有 `getAppSetting(key)` / `setAppSetting(key, value)` + LRU 缓存（TTL 300s）。

## 方案

### Step 1: 后端 — DB helpers + 启动迁移

- `db/helpers.ts` 新增 `getServerName()` / `getServerUrl()` / `setServerName()` / `setServerUrl()` 便捷函数
- 新增 `ensureServerInfoDefaults()` 启动函数：如果 DB 无值且 env 有值，自动迁移 env → DB（一次性）

### Step 2: 后端 — settings API 端点

- `routes/settings/general.ts` 新增：
  - `GET /api/settings/server-info` → 返回 `{ name, url }`
  - `PATCH /api/settings/server-info` → 更新 name/url（Zod 验证）

### Step 3: 后端 — 替换所有 `process.env` 读取

- `about.ts` → 改用 `getServerName()` / `getServerUrl()`
- `dispatcher.ts` → 改用 `getServerUrl()`
- `create.ts` → 改用 `getServerUrl()`
- `delete.ts` → 改用 `getServerUrl()`

### Step 4: 前端 — 设置页面 UI

- `kanban-api.ts` 新增 `getServerInfo()` / `updateServerInfo()` API 函数
- `use-kanban.ts` 新增 hooks
- 在适当的设置页面添加 server name/url 编辑表单

## 风险

- **低风险**: appSettings 模式已成熟，有缓存支持
- **兼容性**: 启动时自动迁移 env → DB，现有用户无需修改配置
- **缓存失效**: `setAppSetting` 已内置 `cacheDel`，更新后立即生效

## 范围

- 仅修改 SERVER_NAME / SERVER_URL 相关代码
- 不修改其他环境变量
- 不修改前端 `getIssueUrl()` 逻辑（它已使用 `window.location.origin`）
