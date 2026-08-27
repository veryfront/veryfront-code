# Veryfront Code

[![CI](https://github.com/veryfront/veryfront-code/actions/workflows/cicd.yml/badge.svg?event=merge_group)](https://github.com/veryfront/veryfront-code/actions/workflows/cicd.yml?query=event%3Amerge_group)
[![npm version](https://badge.fury.io/js/veryfront.svg)](https://www.npmjs.com/package/veryfront)
[![codecov](https://codecov.io/gh/veryfront/veryfront-code/branch/main/graph/badge.svg)](https://codecov.io/gh/veryfront/veryfront-code)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

**Build full-stack AI apps and agents with TypeScript and React.**

<p align="center">
  <img src="./assets/banner.svg" alt="Veryfront" width="100%">
</p>

Veryfront Code is an open-source, full-stack framework that keeps React routes,
agents, typed tools, evals, and multi-step workflows in one file-based TypeScript
project. Developers and coding agents work from the same source and conventions.

Run the same project on Node.js, Deno, or Bun. Connect directly to model
providers or OpenAI-compatible local services.

[Self-host](https://veryfront.com/docs/code/guides/self-hosting) without a
Veryfront account. Use the [Veryfront Cloud AI Gateway](https://veryfront.com/docs/code/guides/providers#veryfront-cloud-ai-gateway)
for managed model access, and use [Veryfront Cloud](https://veryfront.com/docs/code/getting-started/cloud-quickstart)
for previews and production hosting.

## Capabilities

Build agents, workflows, and full-stack React applications from one TypeScript project.

- [**Agents**](https://veryfront.com/docs/code/guides/agents) - Build AI agents that reason and act. Give them instructions, models, tools, skills, memory, and durable hosted execution.

- [**Skills**](https://veryfront.com/docs/code/guides/skills) - Add project-level agent capabilities with `SKILL.md` files. Skills package instructions, allowed tools, and scripts.

- [**Tools**](https://veryfront.com/docs/code/guides/tools) - Define Zod-validated functions that agents can call. Tools are discovered from files, so you do not need manual registration.

- [**Prompts**](https://veryfront.com/docs/code/concepts/prompt) - Reuse named prompt templates across agents, tools, MCP servers, and application code.

- [**Knowledge**](https://veryfront.com/docs/code/guides/cli-knowledge-ingestion) - Turn source documents into project knowledge files that agents can use as context.

- [**Memory & Streaming**](https://veryfront.com/docs/code/guides/memory-and-streaming) - Give agents conversation history, streamed responses, and React chat UI components with AG-UI support.

- [**Multi-Agent Systems**](https://veryfront.com/docs/code/guides/multi-agent) - Compose orchestrators and sub-agents that delegate to each other as tools for coordinated work.

- [**Tasks**](https://veryfront.com/docs/code/guides/tasks) - Define file-based background jobs that Veryfront Code discovers and runs as task executions.

- [**Workflows**](https://veryfront.com/docs/code/guides/workflows) - Orchestrate multi-step AI pipelines with branching, parallel steps, approval gates, and durable Redis checkpoints.

- [**Runs**](https://veryfront.com/docs/code/guides/runs) - Execute durable task, workflow, and agent work through project-scoped run records.

- [**MCP Server**](https://veryfront.com/docs/code/guides/mcp-server) - Expose tools, prompts, and resources through MCP with SSE transport, sessions, and elicitation.

- [**Sandbox**](https://veryfront.com/docs/code/guides/sandbox) - Run isolated code in ephemeral compute environments with shell tools and agent-service integration.

- [**Integrations**](https://veryfront.com/docs/code/guides/integrations) - Add third-party services with connectors for OAuth, remote tools, and service metadata.

- [**Pages & Routing**](https://veryfront.com/docs/code/guides/pages-and-routing) - Build app routes with files, React Server Components, layouts, and server-side rendering.

- [**Data Fetching & API Routes**](https://veryfront.com/docs/code/guides/data-fetching) - Load server data, define API handlers, and add [middleware](https://veryfront.com/docs/code/guides/middleware) with built-in [OAuth](https://veryfront.com/docs/code/guides/oauth).

- [**Extensions**](https://veryfront.com/docs/code/guides/extensions) - Extend Veryfront Code with contract-based packages for LLM providers, bundling, CSS, tracing, caching, and more.

## Get started

The default `ai-agent` starter targets Node.js 22.3 or later. This path uses
direct OpenAI inference. Create the project, configure inference, and start the
development server:

```bash
npm create veryfront@latest my-agent -- --template ai-agent
cd my-agent
export OPENAI_API_KEY="<API_KEY>"
npm run dev
```

Open the URL printed by the CLI and ask `What is 128 divided by 8?`. The agent
calls the starter's calculator tool and returns `16`.

To use the Veryfront Cloud AI Gateway, another provider, an OpenAI-compatible
local service, or the optional ONNX extension, [select another inference path](https://veryfront.com/docs/code/guides/providers)
before the first request.

Node.js is the default runtime. Select Deno or Bun explicitly:

```bash
npx veryfront@latest init <PROJECT_NAME> --template ai-agent --runtime deno
npx veryfront@latest init <PROJECT_NAME> --template ai-agent --runtime bun
```

Follow the [Quickstart guide](https://veryfront.com/docs/code/getting-started/quickstart)
for the complete first project, including its smoke eval. See
[Create a project](https://veryfront.com/docs/code/getting-started/create-project)
for every setup option.

<details>
<summary>Use another package manager</summary>

These commands open the project wizard:

```bash
pnpm create veryfront
yarn create veryfront
bun create veryfront
deno init --npm veryfront
```

</details>

<details>
<summary>Choose another starter</summary>

Choose a starter with `--template`:

```bash
npx veryfront@latest init <PROJECT_NAME> --template <TEMPLATE>
```

| Starter              | Starting point                        |
| -------------------- | ------------------------------------- |
| `ai-agent`           | Agent, chat UI, tools, and streaming  |
| `minimal`            | Blank full-stack application          |
| `docs-agent`         | Document Q&A with source citations    |
| `agentic-workflow`   | Steps, approvals, and parallelism     |
| `multi-agent-system` | Agents that delegate to each other    |
| `coding-agent`       | Code assistant with file tools        |
| `saas-starter`       | Authentication, chat, and user memory |

</details>

<details>
<summary>Install the CLI globally</summary>

Install through npm for local development commands and the TUI:

```bash
npm install -g veryfront@latest
```

The standalone binary includes the runtime. Downloads range from 0.9 to 1.2 GB
by platform:

```bash
curl -fsSL https://veryfront.com/install.sh | sh
# or
brew install veryfront/tap/veryfront
```

</details>

## Project structure

Veryfront projects use conventional directories:

```text
app/          React pages, layouts, and API routes
agents/       Agent definitions
tools/        Typed tools
prompts/      Prompt templates
skills/       SKILL.md instruction packs
evals/        Agent and workflow evals
workflows/    Multi-step workflow DAGs
tasks/        Background work targets
schedules/    Scheduled run creation
webhooks/     Webhook triggers
resources/    MCP resources
```

Veryfront discovers these directories at startup. Schedules and webhooks trigger
agent runs, workflow runs, or task runs.

Every starter includes `AGENTS.md` with project guidance. While `veryfront dev`
runs, MCP-aware coding agents can use Veryfront MCP tools for live errors, route
inspection, scaffolding, tests, linting, and HMR. See
[Coding agents](https://veryfront.com/docs/code/guides/coding-agents) and the
[project structure guide](https://veryfront.com/docs/code/guides/project-structure).

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing. For code
changes, open an issue before opening a pull request.

## Support

Use GitHub issues for reproducible bugs and feature requests. Join the
[community Discord](https://discord.gg/xWuRjafrtV) for setup questions and
project discussion.

## Security

Report security vulnerabilities privately to
[security@veryfront.com](mailto:security@veryfront.com). Veryfront responds
within 48 hours.

## License

Apache-2.0
