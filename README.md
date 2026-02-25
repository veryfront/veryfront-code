# Veryfront

[![npm version](https://badge.fury.io/js/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![Socket Badge](https://socket.dev/api/badge/npm/package/veryfront)](https://socket.dev/npm/package/veryfront)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

Veryfront is a full-stack framework for building AI-powered applications and agents with TypeScript and React.

It gives you agents, tools, workflows, and a complete React rendering stack in a single framework. Veryfront runs on Node.js, Deno, and Bun, and can be deployed anywhere or shipped through the Veryfront platform with built-in preview environments and production hosting.

## Why Veryfront?

Purpose-built for TypeScript and React, Veryfront gives you everything you need to build agentic full-stack applications out-of-the-box.

- [**Agents**](https://veryfront.com/docs/code/guides/agents) — Build autonomous agents with model routing, system prompts, and tool calling. Agents reason about goals and iterate until they reach a final answer.

- [**Tools**](https://veryfront.com/docs/code/guides/tools) — Define Zod-validated functions that agents can call. Tools are auto-discovered from the file system with no registration needed.

- [**Workflows**](https://veryfront.com/docs/code/guides/workflows) — Orchestrate multi-step AI pipelines with branching, parallelism, and human-in-the-loop approval gates.

- [**Multi-Agent**](https://veryfront.com/docs/code/guides/multi-agent) — Compose agents that delegate to each other as tools for complex, coordinated tasks.

- [**Memory & Streaming**](https://veryfront.com/docs/code/guides/memory-and-streaming) — Give agents conversation history and streaming responses. Built-in chat UI components for React.

- [**MCP Server**](https://veryfront.com/docs/code/guides/mcp-server) — Expose agents, tools, and resources via the Model Context Protocol. Connect your coding agent to live errors, logs, and HMR.

- [**Pages & Routing**](https://veryfront.com/docs/code/guides/pages-and-routing) — File-based routing with React Server Components, layouts, and server-side rendering.

- [**Data Fetching & API Routes**](https://veryfront.com/docs/code/guides/data-fetching) — Server-side data loading, API route handlers, and [middleware](https://veryfront.com/docs/code/guides/middleware) with built-in [OAuth](https://veryfront.com/docs/code/guides/oauth) support.

## Get Started

The **recommended** way to get started with Veryfront:

```bash
npm create veryfront
```

<details>
<summary>pnpm, yarn, bun, deno</summary>

```bash
pnpm create veryfront
yarn create veryfront
bun create veryfront
deno init --npm veryfront
```

Binary install (recommended for the CLI/TUI):

```bash
curl -fsSL https://veryfront.com/install.sh | sh
# or
brew install veryfront/tap/veryfront
```

</details>

Follow the [Quickstart guide](https://veryfront.com/docs/code/guides/quickstart) for step-by-step setup, or explore our [templates](https://veryfront.com/docs/code/guides/quickstart#templates) to start building with Veryfront today.

## Documentation

Visit our [official documentation](https://veryfront.com/docs/code).

**Getting Started** — [Quickstart](https://veryfront.com/docs/code/guides/quickstart) · [Project Structure](https://veryfront.com/docs/code/guides/project-structure)

**AI** — [Agents](https://veryfront.com/docs/code/guides/agents) · [Tools](https://veryfront.com/docs/code/guides/tools) · [Memory & Streaming](https://veryfront.com/docs/code/guides/memory-and-streaming) · [Chat UI](https://veryfront.com/docs/code/guides/chat-ui) · [Workflows](https://veryfront.com/docs/code/guides/workflows) · [Multi-Agent](https://veryfront.com/docs/code/guides/multi-agent)

**Infrastructure** — [Providers](https://veryfront.com/docs/code/guides/providers) · [Pages & Routing](https://veryfront.com/docs/code/guides/pages-and-routing) · [Data Fetching](https://veryfront.com/docs/code/guides/data-fetching) · [API Routes](https://veryfront.com/docs/code/guides/api-routes) · [Middleware](https://veryfront.com/docs/code/guides/middleware) · [OAuth](https://veryfront.com/docs/code/guides/oauth) · [MCP Server](https://veryfront.com/docs/code/guides/mcp-server) · [Integrations](https://veryfront.com/docs/code/integrations)

**Production** — [Configuration](https://veryfront.com/docs/code/guides/configuration) · [Building & Deploying](https://veryfront.com/docs/code/guides/deploying) · [Head & SEO](https://veryfront.com/docs/code/guides/head-and-seo)

## Contributing

Looking to contribute? All types of help are appreciated, from coding to testing and feature specification. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for more details on how to get involved.

If you are a developer and would like to contribute with code, please open an issue to discuss before opening a Pull Request.

## Support

We have an [open community Discord](https://discord.gg/veryfront). Come say hello and let us know if you have any questions or need help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page](https://github.com/veryfront/veryfront-code).

## Security

We are committed to maintaining the security of Veryfront. If you discover a security vulnerability, please responsibly disclose it to us at [security@veryfront.com](mailto:security@veryfront.com) and we will respond within 48 hours.

## License

Apache-2.0
