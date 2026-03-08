# PLAN-001 添加 server_name 和 server_url 环境变量

- **status**: completed
- **task**: FEAT-001
- **owner**:
- **created**: 2026-03-08

## 上下文

当前复制链接使用 `window.location.origin` 拼接 URL，在反向代理/内网部署场景下不正确。
页面标题硬编码为 `BKD`，多实例部署时无法区分。
Webhook payload 中没有 issue 的外部链接。

## 方案

### 1. 后端：读取环境变量并通过 system-info 接口暴露

- 在 `about.ts` 的 `/api/settings/system-info` 响应中增加 `server` 字段：
  ```json
  {
    "server": {
      "name": "SERVER_NAME value or null",
      "url": "SERVER_URL value or null"
    }
  }
  ```
- `SERVER_NAME` — 实例名称，无默认值（不设置则前端保持 "BKD"）
- `SERVER_URL` — 外部基础 URL（如 `https://bkd.example.com`），无默认值（不设置则前端回退 `window.location.origin`）

### 2. 后端：webhook payload 增加 issueUrl

- 当 `SERVER_URL` 设置时，在 webhook payload 中添加 `issueUrl` 字段

### 3. 前端：动态页面标题

- 在 App 组件中调用 `useSystemInfo`，当 `server.name` 存在时设置 `document.title`

### 4. 前端：复制链接使用 server_url

- 创建一个工具函数 `getIssueUrl(projectId, issueId, serverUrl?)` 统一 URL 构造
- `ChatArea.tsx` 和 `IssuePanel.tsx` 中的 copyLink 使用该函数

### 5. 更新 .env.example

- 添加 `SERVER_NAME` 和 `SERVER_URL` 说明

## 风险

- 无破坏性变更，所有新字段可选，不设置时行为与当前一致
- 前端需要额外一次 API 调用获取 server info（可复用已有 useSystemInfo hook）

## 范围

- 后端 2 个文件修改
- 前端 4-5 个文件修改
- 新增 0 个文件（复用已有模块）
