# Veryfront Code

[![npm version](https://badge.fury.io/js/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![Socket Badge](https://socket.dev/api/badge/npm/package/veryfront)](https://socket.dev/npm/package/veryfront)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

**Put your agents to work.**

Veryfront Code is a full-stack framework for building AI-powered applications and agents with TypeScript and React.

It gives you agents, tools, workflows, and a complete React rendering stack in a single framework. Veryfront Code runs on Node.js, Deno, and Bun, and can be deployed anywhere or shipped through the Veryfront platform with built-in preview environments and production hosting.

<p align="center">
  <img src="./assets/banner.svg" alt="Veryfront" width="100%">
</p>

## Why Veryfront Code?

Purpose-built for TypeScript and React, Veryfront Code gives you everything you need to build agentic full-stack applications out-of-the-box.

- [**Agents**](https://veryfront.com/docs/code/guides/agents) - Build AI agents that reason and act. Give them instructions, models, tools, skills, memory, and durable hosted execution.

- [**Skills**](https://veryfront.com/docs/code/guides/skills) - Add project-level agent capabilities with `SKILL.md` files. Skills package instructions, allowed tools, and scripts.

- [**Tools**](https://veryfront.com/docs/code/guides/tools) - Define Zod-validated functions that agents can call. Tools are discovered from files, so you do not need manual registration.

- [**Prompts**](https://veryfront.com/docs/code/concepts/prompt) - Reuse named prompt templates across agents, tools, MCP servers, and application code.

- [**Knowledge**](https://veryfront.com/docs/code/guides/cli-knowledge-ingestion) - Turn source documents into project knowledge files that agents can use as context.

- [**Memory & Streaming**](https://veryfront.com/docs/code/guides/memory-and-streaming) - Give agents conversation history, streamed responses, and React chat UI components with AG-UI support.

- [**Multi-Agent**](https://veryfront.com/docs/code/guides/multi-agent) - Compose agents that delegate to each other as tools for coordinated work.

- [**Tasks**](https://veryfront.com/docs/code/guides/tasks) - Define file-based background jobs that Veryfront Code discovers and runs as task executions.

- [**Workflows**](https://veryfront.com/docs/code/guides/workflows) - Orchestrate multi-step AI pipelines with branching, parallel steps, approval gates, and durable Redis checkpoints.

- [**Runs**](https://veryfront.com/docs/code/guides/runs) - Execute durable task, workflow, and agent work through project-scoped run records.

- [**MCP Server**](https://veryfront.com/docs/code/guides/mcp-server) - Expose tools, prompts, and resources through MCP with SSE transport, sessions, and elicitation.

- [**Sandbox**](https://veryfront.com/docs/code/guides/sandbox) - Run isolated code in ephemeral compute environments with shell tools and agent-service integration.

- [**Integrations**](https://veryfront.com/docs/code/guides/integrations) - Add third-party services with connectors for OAuth, remote tools, and service metadata.

- [**Pages & Routing**](https://veryfront.com/docs/code/guides/pages-and-routing) - Build app routes with files, React Server Components, layouts, and server-side rendering.

- [**Data Fetching & API Routes**](https://veryfront.com/docs/code/guides/data-fetching) - Load server data, define API handlers, and add [middleware](https://veryfront.com/docs/code/guides/middleware) with built-in [OAuth](https://veryfront.com/docs/code/guides/oauth).

- [**Extensions**](https://veryfront.com/docs/code/guides/extensions) - Extend Veryfront Code with contract-based packages for LLM providers, bundling, CSS, tracing, caching, and more.

## Get Started

Use the interactive project wizard when you want to compare templates:

```bash
npm create veryfront
```

Choose a starting point when you already know what you want to build:

```bash
# Agent app with a chat UI, tool, and AG-UI route
veryfront init support-agent --template ai-agent

# Blank full-stack app with pages and routing
veryfront init my-app --template minimal

# Durable multi-step AI pipeline
veryfront init my-workflow --template agentic-workflow
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

Follow the [Quickstart guide](https://veryfront.com/docs/code/getting-started/quickstart) to build the agent app end-to-end, or use [Create a project](https://veryfront.com/docs/code/getting-started/create-a-project) to compare templates before you scaffold. For the full documentation, visit [veryfront.com/docs/code](https://veryfront.com/docs/code).

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

We have an [open community Discord](https://discord.gg/veryfront). Come say hello and let us know if you have any questions or need help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page](https://github.com/veryfront/veryfront-code).

## Security

We are committed to maintaining the security of Veryfront. If you discover a security vulnerability, please responsibly disclose it to us at [security@veryfront.com](mailto:security@veryfront.com) and we will respond within 48 hours.

## License

Apache-2.0
