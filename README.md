# BitK

AI-powered project management board. Create issues, assign them to AI coding agents, and watch them work in real time.

BitK is a unified frontend for CLI-based coding agents — [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli). You manage a Kanban board; the agents write the code.

[中文说明](README.zh-CN.md)

## Features

- **Kanban Board** — Drag-and-drop issues across Todo / Working / Review / Done columns
- **Multi-Agent** — Supports Claude Code, OpenAI Codex, and Gemini CLI as execution engines
- **Real-time Chat** — Stream agent output as it runs; send follow-up messages mid-session
- **Diff Viewer** — See file changes made by the agent in a GitHub-style diff panel
- **Web Terminal** — Built-in xterm.js terminal for direct shell access
- **File Upload** — Attach files to issues as context for the agent
- **Multi-turn Sessions** — Continue conversations with full session history
- **i18n** — Chinese and English UI
- **Dark Mode** — Light / Dark / System theme
- **Mobile Friendly** — Responsive layout with touch support

## Installation

Download the launcher binary from the [launcher release](https://github.com/bkhq/bitk/releases/tag/launcher-v1). The launcher is a small binary (~90 MB) that automatically downloads and manages app updates (~1 MB each):

**Linux (x64)**

```bash
curl -LO https://github.com/bkhq/bitk/releases/download/launcher-v1/bitk-launcher-linux-x64
chmod +x bitk-launcher-linux-x64
./bitk-launcher-linux-x64
```

**macOS (Apple Silicon)**

```bash
curl -LO https://github.com/bkhq/bitk/releases/download/launcher-v1/bitk-launcher-darwin-arm64
chmod +x bitk-launcher-darwin-arm64
./bitk-launcher-darwin-arm64
```

The launcher stays fixed across versions — only the lightweight app package gets updated. Open http://localhost:3000 after starting.

## System Requirements

BitK spawns AI coding agents as child processes. Install at least one before using:

### Claude Code (Recommended)

```bash
npm install -g @anthropic-ai/claude-code
```

Requires `ANTHROPIC_API_KEY` in your environment or configured via `claude` CLI.

### OpenAI Codex

```bash
npm install -g @openai/codex
```

Requires `OPENAI_API_KEY` or `CODEX_API_KEY`.

### Gemini CLI

```bash
npm install -g @google/gemini-cli
```

Requires `GOOGLE_API_KEY` or `GEMINI_API_KEY`.

> BitK auto-detects which agents are installed at startup. You can use any combination.

## Usage

1. **Create a project** — Give it a name and set the workspace directory (the repo the agents will work in)
2. **Create an issue** — Describe the task, pick an AI engine and model
3. **Execute** — Click execute; the agent spawns in your workspace and starts working
4. **Chat** — Send follow-up messages, upload files, or cancel at any time
5. **Review** — View diffs, check the agent's tool calls, drag the issue to Done

## Configuration

All configuration is done via environment variables. Create a `.env` file in the project root or set them in your environment:

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | Server port | `3000` |
| `API_HOST` | Listen address | `0.0.0.0` |
| `DB_PATH` | SQLite database path | `data/db/bitk.db` |
| `MAX_CONCURRENT_EXECUTIONS` | Max parallel agent sessions | `5` |
| `LOG_LEVEL` | Log level (`trace` / `debug` / `info` / `warn` / `error`) | `info` |
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `OPENAI_API_KEY` | OpenAI / Codex API key | — |
| `GOOGLE_API_KEY` | Gemini API key | — |

## Development

See [docs/development.md](docs/development.md) for development setup, project structure, and contribution guidelines.

## License

Apache-2.0
