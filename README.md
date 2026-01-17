# Veryfront

[![npm version](https://img.shields.io/npm/v/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![CI/CD](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/veryfront/veryfront-renderer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Veryfront is a full-stack React framework for building AI apps and agents with zero configuration.

## Features

- 🚀 **Zero config** — Auto-discovery from file structure
- 🌐 **Multi-runtime** — Deno, Node.js, Bun, Cloudflare Workers
- ⚛️ **Full-stack React** — SSR, SSG, ISR, streaming
- 🤖 **MCP built-in** — Model Context Protocol server
- 🏭 **Production-ready** — Rate limiting, caching, observability

## Quick Start

```bash
npx veryfront
```

Add your API key to `.env` and run `deno task dev`.

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
- [Twitter](https://twitter.com/veryfrontdev)
- [GitHub Discussions](https://github.com/veryfront/veryfront/discussions)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
