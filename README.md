# Veryfront

[![npm version](https://badge.fury.io/js/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![Socket Badge](https://socket.dev/api/badge/npm/package/veryfront)](https://socket.dev/npm/package/veryfront)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

Veryfront is a full-stack framework for building AI-powered applications and agents with TypeScript and React.

It gives you agents, tools, workflows, and a complete React rendering stack in a single framework. Veryfront runs on Node.js, Deno, and Bun, and can be deployed anywhere or shipped through the Veryfront platform with built-in preview environments and production hosting.

## Why Veryfront?

Purpose-built for TypeScript and React, Veryfront gives you everything you need to build agentic full-stack applications out-of-the-box.

- [**Agents**](https://veryfront.com/docs/code/guides/agents) - Build autonomous agents with model routing, system prompts, hosted execution, and tool calling. Agents reason about goals and iterate until they reach a final answer. Supports AG-UI streaming, multi-agent composition, and hosted child-run orchestration.

- [**Tools**](https://veryfront.com/docs/code/guides/tools) - Define Zod-validated functions that agents can call. Tools are auto-discovered from the file system with no registration needed.

- [**Workflows**](https://veryfront.com/docs/code/guides/workflows) - Orchestrate multi-step AI pipelines with branching, parallelism, human-in-the-loop approval gates, and durable crash recovery via Redis checkpoints.

- [**Skills**](https://veryfront.com/docs/code/guides/skills) - Project-level agent capabilities defined as `SKILL.md` files following the agentskills.io specification. Skills provide prompt augmentation, tool allowlists, and script execution.

- [**Runs**](https://veryfront.com/docs/code/guides/runs) - Run durable project-scoped task and workflow definitions through the Veryfront platform.

- [**Tasks**](https://veryfront.com/docs/code/guides/tasks) - File-based background task definitions discovered automatically and executable as task runs.

- [**Multi-Agent**](https://veryfront.com/docs/code/guides/multi-agent) - Compose agents that delegate to each other as tools for complex, coordinated tasks. AG-UI control-plane for hosted agent orchestration.

- [**Memory & Streaming**](https://veryfront.com/docs/code/guides/memory-and-streaming) - Give agents conversation history and streaming responses. Built-in chat UI components for React with AG-UI protocol support.

- [**MCP Server**](https://veryfront.com/docs/code/guides/mcp-server) - Expose tools, prompts, and resources via the Model Context Protocol. Includes SSE transport, session management, and elicitation support.

- [**Sandbox**](https://veryfront.com/docs/code/guides/sandbox) - Ephemeral compute environments for isolated code execution with shell tools and agent service integration.

- [**Integrations**](https://veryfront.com/docs/code/guides/integrations) - Pre-built connectors with OAuth flows, remote tools, and metadata for third-party services.

- [**Pages & Routing**](https://veryfront.com/docs/code/guides/pages-and-routing) - File-based routing with React Server Components, layouts, and server-side rendering.

- [**Data Fetching & API Routes**](https://veryfront.com/docs/code/guides/data-fetching) - Server-side data loading, API route handlers, and [middleware](https://veryfront.com/docs/code/guides/middleware) with built-in [OAuth](https://veryfront.com/docs/code/guides/oauth) support.

- [**Extensions**](./docs/guides/extensions.md) - Contract-based plugin system with 12 first-party packages for LLM providers, bundling, CSS, tracing, caching, and more.

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

Follow the [Quickstart guide](https://veryfront.com/docs/code/getting-started/quickstart) for step-by-step setup, or use [Create a project](https://veryfront.com/docs/code/getting-started/create-a-project) to compare templates before you scaffold. For the full documentation, visit [veryfront.com/docs/code](https://veryfront.com/docs/code).

## Project Structure

```
veryfront/
├── src/                  # Framework core modules
│   ├── agent/           # Agent runtime, AG-UI, hosted execution
│   ├── tool/            # Tool definitions and registry
│   ├── workflow/        # Durable DAG workflows with crash recovery
│   ├── mcp/             # Model Context Protocol server
│   ├── skill/           # Agent skills system (SKILL.md)
│   ├── chat/            # Chat UI components and streaming
│   ├── discovery/       # Auto-discovery of tools, agents, workflows
│   ├── sandbox/         # Ephemeral compute environments
│   ├── runs/            # Durable runs client
│   ├── task/            # Task definitions and runner
│   ├── channels/        # Control-plane agent routing
│   ├── integrations/    # Third-party connector metadata
│   ├── provider/        # AI model provider adapters
│   ├── rendering/       # SSR/RSC engine
│   ├── server/          # HTTP servers (dev + production)
│   ├── routing/         # File-based routing
│   ├── security/        # Rate limiting, CORS, CSP, validation
│   └── ...              # See src/README.md for full list
├── cli/                  # CLI and TUI dashboard
├── extensions/           # First-party extension packages
├── docs/                 # Architecture diagrams and guides
├── tests/                # Integration and E2E tests
└── scripts/              # Development and build scripts
```

## Examples

You can find standalone, runnable examples in the [veryfront-examples](https://github.com/veryfront/veryfront-examples) repo.

## Contributing

Looking to contribute? All types of help are appreciated, from coding to testing and feature specification. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for more details on how to get involved.

If you are a developer and would like to contribute with code, please open an issue to discuss before opening a Pull Request.

## Support

We have an [open community Discord](https://discord.gg/xWuRjafrtV). Come say hello and let us know if you have any questions or need help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page](https://github.com/veryfront/veryfront-code).

## Security

We are committed to maintaining the security of Veryfront. If you discover a security vulnerability, please responsibly disclose it to us at [security@veryfront.com](mailto:security@veryfront.com) and we will respond within 48 hours.

## License

Apache-2.0
