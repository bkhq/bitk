# BKD

AI 驱动的项目管理看板。创建 Issue，分配给 AI 编程代理，实时观看它们工作。

BKD 是 CLI 编程代理的统一前端 —— 支持 [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex) 和 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。你管理看板，代理写代码。

[English](README.md)

## 功能

- **看板** — 拖拽 Issue 在 待办 / 进行中 / 审查 / 完成 列之间移动
- **多代理** — 支持 Claude Code、OpenAI Codex、Gemini CLI 作为执行引擎
- **实时对话** — 流式输出代理运行结果；运行中可发送追加消息
- **Diff 查看器** — GitHub 风格的差异面板，查看代理所做的文件改动
- **文件浏览器** — 浏览、查看项目文件，支持语法高亮
- **Web 终端** — 内置 xterm.js 终端，直接访问 Shell
- **文件上传** — 上传文件作为代理的上下文
- **Webhooks** — 可配置的事件通知，支持 Issue 状态变更推送
- **多轮会话** — 保持完整会话历史，支持连续对话
- **自动升级** — 自动检查新版本，设置界面一键升级
- **国际化** — 中文 / 英文界面
- **暗色模式** — 浅色 / 深色 / 跟随系统
- **移动端适配** — 响应式布局，支持触控

## 安装

从 [launcher release](https://github.com/bkhq/bkd/releases/tag/launcher-v1) 下载启动器。启动器是一个小型二进制文件（约 90 MB），会自动下载和管理应用更新（每次约 1 MB）：

**Linux (x64)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-linux-x64
chmod +x bkd-launcher-linux-x64
./bkd-launcher-linux-x64
```

**macOS (Apple Silicon)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-darwin-arm64
chmod +x bkd-launcher-darwin-arm64
xattr -cr bkd-launcher-darwin-arm64
./bkd-launcher-darwin-arm64
```

**macOS (Intel)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-darwin-x64
chmod +x bkd-launcher-darwin-x64
./bkd-launcher-darwin-x64
```

启动器跨版本保持不变，只有轻量级的应用包会被更新。启动后打开 http://localhost:3000。

## 系统要求

BKD 以子进程方式启动 AI 编程代理，使用前请至少安装其中一个：

### Claude Code（推荐）

```bash
npm install -g @anthropic-ai/claude-code
```

需要在环境变量中设置 `ANTHROPIC_API_KEY`，或通过 `claude` CLI 完成认证。

### OpenAI Codex

```bash
npm install -g @openai/codex
```

需要 `OPENAI_API_KEY` 或 `CODEX_API_KEY`，或通过 `codex` CLI 完成认证。

### Gemini CLI

```bash
npm install -g @google/gemini-cli
```

需要 `GOOGLE_API_KEY` 或 `GEMINI_API_KEY`，或通过 `gemini` CLI 完成认证。

> BKD 启动时会自动检测已安装的代理，可以任意组合使用。

## 使用方法

1. **创建项目** — 设置项目名称和工作目录（代理将在该仓库中工作）
2. **创建 Issue** — 描述任务内容，选择 AI 引擎和模型
3. **执行** — 点击执行，代理在你的工作目录中启动并开始工作
4. **对话** — 随时发送追加消息、上传文件或取消执行
5. **审查** — 查看 Diff、检查代理的工具调用记录，拖拽 Issue 到完成

## 配置

所有配置通过环境变量完成。在 `apps/api/` 目录创建 `.env` 文件（Bun 自动加载）或设置环境变量。完整模板见 `apps/api/.env.example`。

| 变量                        | 说明                                                      | 默认值           |
| --------------------------- | --------------------------------------------------------- | ---------------- |
| `PORT`                      | 服务端口                                                  | `3000`           |
| `HOST`                      | 监听地址                                                  | `0.0.0.0`        |
| `ROOT_DIR`                  | 工作区根目录                                              | 自动检测         |
| `DB_PATH`                   | SQLite 数据库路径                                         | `data/db/bkd.db` |
| `LOG_LEVEL`                 | 日志级别（`trace` / `debug` / `info` / `warn` / `error`） | `info`           |
| `SERVICE_NAME`              | 日志名称前缀                                              | `bkd`            |
| `LOG_EXECUTOR_IO`           | 记录执行器 stdin/stdout（`1` = 开启，`0` = 关闭）         | `1`              |
| `ANTHROPIC_API_KEY`         | Claude API 密钥                                           | —                |
| `OPENAI_API_KEY`            | OpenAI / Codex API 密钥                                   | —                |
| `CODEX_API_KEY`             | Codex 专用 API 密钥（备选）                               | —                |
| `GOOGLE_API_KEY`            | Google Gemini API 密钥                                    | —                |
| `GEMINI_API_KEY`            | Gemini 专用 API 密钥（备选）                              | —                |
| `ENABLE_RUNTIME_ENDPOINT`   | 启用 `/api/runtime` 调试端点                              | 禁用             |

服务器名称、服务器 URL、Webhooks、最大并发数等运行时设置在设置界面中管理，持久化存储在数据库中。环境变量 `SERVER_NAME` 和 `SERVER_URL` 仅作为初始种子值 —— 一旦在界面中设置，数据库中的值优先。

## 开发

参见 [docs/development.md](docs/development.md) 了解开发环境搭建、项目结构和贡献指南。

## 许可证

Apache-2.0
