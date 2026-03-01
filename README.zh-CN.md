# BitK

AI 驱动的项目管理看板。创建 Issue，分配给 AI 编程代理，实时观看它们工作。

BitK 是 CLI 编程代理的统一前端 —— 支持 [Claude Code](https://github.com/anthropics/claude-code)、[Codex](https://github.com/openai/codex) 和 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。你管理看板，代理写代码。

[English](README.md)

## 功能

- **看板** — 拖拽 Issue 在 待办 / 进行中 / 审查 / 完成 列之间移动
- **多代理** — 支持 Claude Code、OpenAI Codex、Gemini CLI 作为执行引擎
- **实时对话** — 流式输出代理运行结果；运行中可发送追加消息
- **Diff 查看器** — GitHub 风格的差异面板，查看代理所做的文件改动
- **Web 终端** — 内置 xterm.js 终端，直接访问 Shell
- **文件上传** — 上传文件作为代理的上下文
- **多轮会话** — 保持完整会话历史，支持连续对话
- **国际化** — 中文 / 英文界面
- **暗色模式** — 浅色 / 深色 / 跟随系统
- **移动端适配** — 响应式布局，支持触控

## 前置条件

BitK 以子进程方式启动 AI 编程代理，使用前请至少安装其中一个：

### Claude Code（推荐）

```bash
npm install -g @anthropic-ai/claude-code
```

需要在环境变量中设置 `ANTHROPIC_API_KEY`，或通过 `claude` CLI 完成认证。

### OpenAI Codex

```bash
npm install -g @openai/codex
```

需要 `OPENAI_API_KEY` 或 `CODEX_API_KEY`。

### Gemini CLI

```bash
npm install -g @google/gemini-cli
```

需要 `GOOGLE_API_KEY` 或 `GEMINI_API_KEY`。

> BitK 启动时会自动检测已安装的代理，可以任意组合使用。

## 快速开始

```bash
# 1. 安装 Bun（如果还没有）
curl -fsSL https://bun.sh/install | bash

# 2. 克隆并安装依赖
git clone <repo-url> bitk && cd bitk
bun install

# 3. 配置环境变量（可选）
cp .env.example .env
# 编辑 .env 设置 API 密钥、端口等

# 4. 启动开发服务器
bun run dev
```

开发服务器会在 3010 端口启动 API，3000 端口启动 Vite 前端。打开 http://localhost:3000 即可使用。

## 使用方法

1. **创建项目** — 设置项目名称和工作目录（代理将在该仓库中工作）
2. **创建 Issue** — 描述任务内容，选择 AI 引擎和模型
3. **执行** — 点击执行，代理在你的工作目录中启动并开始工作
4. **对话** — 随时发送追加消息、上传文件或取消执行
5. **审查** — 查看 Diff、检查代理的工具调用记录，拖拽 Issue 到完成

## 脚本命令

```bash
# 开发
bun run dev              # API + 前端（通过 --filter 并行启动）
bun run dev:api          # 仅 API（端口 3010）
bun run dev:frontend     # 仅前端（端口 3000）

# 代码质量
bun run lint             # Biome 检查（所有工作区）
bun run format           # Biome 格式化（所有工作区）
bun run format:check

# 测试
bun run test             # 所有测试（并行）
bun run test:api         # 仅后端测试
bun run test:frontend    # 仅前端测试

# 数据库
bun run db:generate      # 生成迁移 SQL
bun run db:migrate       # 执行迁移
bun run db:reset         # 重置 SQLite 数据库

# 生产部署
bun run build            # 构建前端
bun run start            # 生产服务器（端口 3000）
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) |
| 后端 | [Hono](https://hono.dev) |
| 数据库 | SQLite + [Drizzle ORM](https://orm.drizzle.team) |
| 前端 | React 19 + [Vite](https://vite.dev) |
| 样式 | [Tailwind CSS](https://tailwindcss.com) v4 |
| 拖拽 | [@dnd-kit/react](https://dndkit.com) |
| 终端 | [xterm.js](https://xtermjs.org) |
| 国际化 | [i18next](https://www.i18next.com) |

## 环境变量

完整配置参见 [`.env.example`](.env.example)，主要变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_PORT` | 服务端口 | `3000` |
| `API_SECRET` | Bearer 认证令牌（未设置则无需认证） | — |
| `DB_PATH` | SQLite 数据库路径 | `data/bitk.db` |
| `MAX_CONCURRENT_EXECUTIONS` | 最大并行代理会话数 | `5` |
| `ANTHROPIC_API_KEY` | Claude API 密钥 | — |
| `OPENAI_API_KEY` | OpenAI / Codex API 密钥 | — |
| `GOOGLE_API_KEY` | Gemini API 密钥 | — |

## 许可证

MIT
