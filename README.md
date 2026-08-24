# Veryfront Code

[![CI/CD](https://github.com/veryfront/veryfront-code/actions/workflows/cicd.yml/badge.svg?branch=main)](https://github.com/veryfront/veryfront-code/actions/workflows/cicd.yml)
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

## Capabilities

- **Agents and tools** - Build [agents](https://veryfront.com/docs/code/guides/agents) with instructions, models, memory, delegation, and file-discovered [Zod-validated tools](https://veryfront.com/docs/code/guides/tools).

- **Instructions and context** - Package reusable behavior as [skills](https://veryfront.com/docs/code/guides/skills), share named [prompts](https://veryfront.com/docs/code/concepts/prompt), and ingest source-controlled [project knowledge](https://veryfront.com/docs/code/guides/cli-knowledge-ingestion).

- **Evaluation and execution** - Test behavior with [evals](https://veryfront.com/docs/code/guides/evals). Execute [workflows](https://veryfront.com/docs/code/guides/workflows) and [tasks](https://veryfront.com/docs/code/guides/tasks) through durable [runs](https://veryfront.com/docs/code/guides/runs). Trigger runs with [schedules](https://veryfront.com/docs/code/concepts/schedule) and [webhooks](https://veryfront.com/docs/code/concepts/webhook).

- **Application stack** - Build [React pages and routes](https://veryfront.com/docs/code/guides/pages-and-routing), React Server Components, and API routes with server-side rendering. Add [middleware](https://veryfront.com/docs/code/guides/middleware), [OAuth](https://veryfront.com/docs/code/guides/oauth), and [AG-UI streaming](https://veryfront.com/docs/code/guides/memory-and-streaming) to applications.

- **Protocols and integrations** - Expose tools, prompts, and resources over [MCP](https://veryfront.com/docs/code/guides/mcp-server). Connect third-party services through [integrations](https://veryfront.com/docs/code/guides/integrations).

- **Providers and runtime** - Configure [model providers](https://veryfront.com/docs/code/guides/providers), add optional [extensions](https://veryfront.com/docs/code/guides/extensions) such as in-process ONNX inference, and connect a compatible backing service for isolated [sandbox sessions](https://veryfront.com/docs/code/guides/sandbox).

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
