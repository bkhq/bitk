# BitK

AI-powered project management board. Create issues, assign them to AI coding agents, and watch them work in real time.

BitK acts as a unified frontend for CLI-based coding agents — [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), and [Gemini CLI](https://github.com/google-gemini/gemini-cli). You manage a Kanban board; the agents write the code.

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

## Prerequisites

BitK spawns AI coding agents as child processes. You must install at least one before using it:

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

## Getting Started

```bash
# 1. Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# 2. Clone and install
git clone <repo-url> bitk && cd bitk
bun install

# 3. Configure environment (optional)
cp .env.example .env
# Edit .env to set API keys, port, etc.

# 4. Start development server
bun run dev
```

The dev server starts the API on port 3010 and the Vite frontend on port 3000. Open http://localhost:3000.

## Usage

1. **Create a project** — Give it a name and set the workspace directory (the repo the agents will work in)
2. **Create an issue** — Describe the task, pick an AI engine and model
3. **Execute** — Click execute; the agent spawns in your workspace and starts working
4. **Chat** — Send follow-up messages, upload files, or cancel at any time
5. **Review** — View diffs, check the agent's tool calls, drag the issue to Done

## Scripts

```bash
# Development
bun run dev              # API + frontend (parallel via --filter)
bun run dev:api          # API only (port 3010)
bun run dev:frontend     # Frontend only (port 3000)

# Code Quality
bun run lint             # Biome check (all workspaces)
bun run format           # Biome format (all workspaces)
bun run format:check

# Testing
bun run test             # All tests (parallel)
bun run test:api         # Backend tests only
bun run test:frontend    # Frontend tests only

# Database
bun run db:generate      # Generate migration SQL
bun run db:migrate       # Apply migrations
bun run db:reset         # Reset SQLite DB

# Production
bun run build            # Build frontend
bun run start            # Production server (port 3000)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Backend | [Hono](https://hono.dev) |
| Database | SQLite + [Drizzle ORM](https://orm.drizzle.team) |
| Frontend | React 19 + [Vite](https://vite.dev) |
| Styling | [Tailwind CSS](https://tailwindcss.com) v4 |
| DnD | [@dnd-kit/react](https://dndkit.com) |
| Terminal | [xterm.js](https://xtermjs.org) |
| i18n | [i18next](https://www.i18next.com) |

## Environment Variables

See [`.env.example`](.env.example) for all options. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `API_PORT` | Server port | `3000` |
| `API_SECRET` | Bearer token for auth (unset = no auth) | — |
| `DB_PATH` | SQLite database path | `data/bitk.db` |
| `MAX_CONCURRENT_EXECUTIONS` | Max parallel agent sessions | `5` |
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `OPENAI_API_KEY` | OpenAI / Codex API key | — |
| `GOOGLE_API_KEY` | Gemini API key | — |

## License

MIT
