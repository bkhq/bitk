# BKD

AI-powered project management board. Create issues, assign them to AI coding agents, and watch them work in real time.

BKD is a unified frontend for CLI-based coding agents — [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli). You manage a Kanban board; the agents write the code.

[中文说明](README.zh-CN.md)

## Features

- **Kanban Board** — Drag-and-drop issues across Todo / Working / Review / Done columns
- **Multi-Agent** — Supports Claude Code, OpenAI Codex, and Gemini CLI as execution engines
- **Real-time Chat** — Stream agent output as it runs; send follow-up messages mid-session
- **Diff Viewer** — See file changes made by the agent in a GitHub-style diff panel
- **File Browser** — Browse, view, and navigate project files with syntax highlighting
- **Web Terminal** — Built-in xterm.js terminal for direct shell access
- **File Upload** — Attach files to issues as context for the agent
- **Webhooks** — Configurable event notifications for issue status changes
- **Multi-turn Sessions** — Continue conversations with full session history
- **Auto-Upgrade** — Automatic version checking and one-click upgrade from the settings UI
- **i18n** — Chinese and English UI
- **Dark Mode** — Light / Dark / System theme
- **Mobile Friendly** — Responsive layout with touch support

## Installation

Download the launcher binary from the [launcher release](https://github.com/bkhq/bkd/releases/tag/launcher-v1). The launcher is a small binary (~90 MB) that automatically downloads and manages app updates (~1 MB each):

**Linux (x64)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-linux-x64
chmod +x bkd-launcher-linux-x64
./bkd-launcher-linux-x64
```

**Linux (ARM64)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-linux-arm64
chmod +x bkd-launcher-linux-arm64
./bkd-launcher-linux-arm64
```

**macOS (Apple Silicon)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-darwin-arm64
chmod +x bkd-launcher-darwin-arm64
./bkd-launcher-darwin-arm64
```

**macOS (Intel)**

```bash
curl -LO https://github.com/bkhq/bkd/releases/download/launcher-v1/bkd-launcher-darwin-x64
chmod +x bkd-launcher-darwin-x64
./bkd-launcher-darwin-x64
```

> **macOS note:** If macOS blocks the binary with "cannot be opened because the developer cannot be verified", run `xattr -cr <binary>` to remove the quarantine attribute before executing.

The launcher stays fixed across versions — only the lightweight app package gets updated. Open http://localhost:3000 after starting.

## System Requirements

BKD spawns AI coding agents as child processes. Install at least one before using:

### Claude Code (Recommended)

```bash
npm install -g @anthropic-ai/claude-code
```

Requires `ANTHROPIC_API_KEY` in your environment or configured via `claude` CLI.

### OpenAI Codex

```bash
npm install -g @openai/codex
```

Requires `OPENAI_API_KEY` or `CODEX_API_KEY`, or authenticate via `codex` CLI.

### Gemini CLI

```bash
npm install -g @google/gemini-cli
```

Requires `GOOGLE_API_KEY` or `GEMINI_API_KEY`, or authenticate via `gemini` CLI.

> BKD auto-detects which agents are installed at startup. You can use any combination.

## BKD Skill

This repository includes a single BKD skill package at `skills/bkd/`. Install it with `npx skills` and use it to operate a running BKD server through the REST API.

### Prerequisite

Before using the skill, point `BKD_URL` at the BKD API root:

```bash
export BKD_URL=http://localhost:3000/api
```

### Global (all projects)

```bash
npx skills add bkhq/bkd --skill bkd --global
```

### Project (current project only)

```bash
npx skills add bkhq/bkd --skill bkd
```

Restart Codex after installing the skill. You can then invoke it with prompts such as `Use $bkd to list projects` or `Use $bkd to check execution capacity`.

## Usage

1. **Create a project** — Give it a name and set the workspace directory (the repo the agents will work in)
2. **Create an issue** — Describe the task, pick an AI engine and model
3. **Execute** — Click execute; the agent spawns in your workspace and starts working
4. **Chat** — Send follow-up messages, upload files, or cancel at any time
5. **Review** — View diffs, check the agent's tool calls, drag the issue to Done

## Configuration

All configuration is done via environment variables. Create a `.env` file in the project root (Bun auto-loads it) or set them in your shell. See `.env.example` for a full template.

| Variable                    | Description                                               | Default          |
| --------------------------- | --------------------------------------------------------- | ---------------- |
| `PORT`                      | Server port                                               | `3000`           |
| `HOST`                      | Listen address                                            | `0.0.0.0`        |
| `ROOT_DIR`                  | Workspace root directory                                  | auto-detected    |
| `DB_PATH`                   | SQLite database path                                      | `data/db/bkd.db` |
| `LOG_LEVEL`                 | Log level (`trace` / `debug` / `info` / `warn` / `error`) | `info`           |
| `SERVICE_NAME`              | Logger name prefix                                        | `bkd`            |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout (`1` = on, `0` = off)           | `1`              |
| `ANTHROPIC_API_KEY`         | Claude API key                                            | —                |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                                    | —                |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)                         | —                |
| `GOOGLE_API_KEY`            | Google Gemini API key                                     | —                |
| `GEMINI_API_KEY`            | Gemini-specific API key (fallback)                        | —                |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint                      | disabled         |

Server name, server URL, webhooks, max concurrency, and other runtime settings are managed in the Settings UI and persisted in the database. Environment variables `SERVER_NAME` and `SERVER_URL` are used as initial seed values only — once set in the UI, database values take precedence.

## Development

See [docs/development.md](docs/development.md) for development setup, project structure, and contribution guidelines.

## License

Apache-2.0
