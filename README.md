# Veryfront

[![npm version](https://img.shields.io/npm/v/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![CI/CD](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The all-in-one React framework for building AI-powered applications and agents.

## Features

- **Zero config** — Auto-discovery from file structure
- **Multi-runtime** — Deno, Node.js, Bun, Cloudflare Workers
- **Full-stack React** — SSR, SSG, ISR, streaming
- **MCP built-in** — Model Context Protocol server
- **Production-ready** — Rate limiting, caching, observability

## Quick Start

```bash
npx veryfront
```

## Commands

| Command                      | What it does                       | When to use                                    |
| ---------------------------- | ---------------------------------- | ---------------------------------------------- |
| `npx veryfront`              | Starts TUI dashboard on port 8080  | Explore projects and develop interactively     |
| `npx veryfront init`         | Create a new project               | Start a new Veryfront app from scratch         |
| `npx veryfront dev`          | Starts dev server on port 3000     | Develop a specific project with HMR            |
| `npx veryfront build`        | Production build                   | Prepare app for deployment                     |
| `npx veryfront deploy`       | Deploy to Veryfront Cloud          | Ship app to production                         |
| `npx veryfront --port 3001`  | TUI on custom port                 | Port 8080 is busy                              |
| `npx veryfront --headless`   | Server without TUI                 | Running in CI or want logs only                |
| `npx veryfront doctor`       | Check system health                | Something isn't working, need diagnostics      |
| `npx veryfront --help`       | Show all commands                  | See what's available                           |

## Project Structure

```
my-app/
├── app/                     # App Router (pages & APIs)
│   ├── chat/page.tsx
│   └── api/chat/route.ts
├── agents/                  # AI agents
├── tools/                   # MCP tools
├── workflows/               # Durable workflows
├── prompts/                 # Prompt templates
└── resources/               # MCP resources
```

All directories are auto-discovered.

## Documentation

- [Getting Started](https://veryfront.com/docs/framework)
- [Agents](https://veryfront.com/docs/framework/agents)
- [Tools](https://veryfront.com/docs/framework/tools)
- [Workflows](https://veryfront.com/docs/framework/workflows)
- [MCP Server](https://veryfront.com/docs/framework/mcp)

## Community

- [Discord](https://discord.gg/veryfront)
- [X](https://x.com/veryfrontdev)
- [GitHub Discussions](https://github.com/veryfront/veryfront/discussions)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
