---
title: "Veryfront Code"
description: "What Veryfront Code is, why to use it, and a map of every guide grouped by topic."
order: 1
---

Veryfront Code is a Deno-first, full-stack framework for building
AI-powered applications and agents in TypeScript and React. Agents,
workflows, tools, pages, APIs, and rendering are all native primitives
in one package - not glued together from separate libraries. Veryfront
runs on Node.js, Deno, and Bun, and deploys anywhere or through
Veryfront Cloud with built-in preview environments and production
hosting.

## Why Veryfront Code

Purpose-built for TypeScript and React, Veryfront Code gives you
everything you need to build agentic full-stack applications
out-of-the-box.

- [**Agents**](../guides/agents.md) - Build autonomous agents with model
  routing, system prompts, hosted runs, and tool calling. Agents
  reason about goals and iterate until they reach a final answer.
  Supports AG-UI streaming, multi-agent composition, and hosted
  child-run orchestration.

- [**Tools**](../guides/tools.md) - Define Zod-validated functions that
  agents can call. Tools are auto-discovered from the file system
  with no registration needed.

- [**Workflows**](../guides/workflows.md) - Orchestrate multi-step AI
  pipelines with branching, parallelism, human-in-the-loop approval
  gates, and durable crash recovery via Redis checkpoints.

- [**Skills**](../guides/skills.md) - Project-level agent capabilities
  defined as `SKILL.md` files following the agentskills.io
  specification. Skills provide prompt augmentation, tool allowlists,
  and script invocation.

- [**Jobs & Cron Jobs**](../guides/jobs.md) - Run durable project-scoped
  background work now or on a schedule through the Veryfront
  platform.

- [**Tasks**](../guides/tasks.md) - File-based background task definitions
  discovered automatically and runnable via the jobs system.

- [**Multi-Agent**](../guides/multi-agent.md) - Compose agents that delegate
  to each other as tools for complex, coordinated tasks. AG-UI
  control-plane for hosted agent orchestration.

- [**Memory & Streaming**](../guides/memory-and-streaming.md) - Give agents
  conversation history and streaming responses. Built-in chat UI
  components for React with AG-UI protocol support.

- [**MCP Server**](../guides/mcp-server.md) - Expose tools, prompts, and
  resources via the Model Context Protocol. Includes SSE transport,
  session management, and elicitation support.

- [**Sandbox**](../guides/sandbox.md) - Ephemeral compute environments for
  isolated code runs with shell tools and agent service
  integration.

- [**Integrations**](../guides/integrations.md) - Pre-built connectors with
  OAuth flows, remote tools, and metadata for third-party services.

- [**Pages & Routing**](../guides/pages-and-routing.md) - File-based routing
  with React Server Components, layouts, and server-side rendering.

- [**Data Fetching & API Routes**](../guides/data-fetching.md) - Server-side
  data loading, API route handlers, and [middleware](../guides/middleware.md)
  with built-in [OAuth](../guides/oauth.md) support.

- [**Extensions**](../guides/extensions.md) - Contract-based plugin system
  with 12 first-party packages for LLM providers, bundling, CSS,
  tracing, caching, and more.

## Guides

Topic-grouped catalog of every guide. Each guide is a task-oriented
walkthrough or decision guide for one concrete piece of the framework.

### Getting Started

Quickstart gives you the full path in one guide. The six guides below
split that path into focused tasks.

| Step                                        | What you will do                                                     |
| ------------------------------------------- | -------------------------------------------------------------------- |
| [Quickstart](./quickstart.md)               | Build an agent app with a tool, chat UI, and deploy path.            |
| [Installation](./installation.md)           | Install the Veryfront CLI and framework on macOS, Linux, or Windows. |
| [Create a project](./create-a-project.md)   | Scaffold a project from a template and run it on the dev server.     |
| [Create an agent](./create-an-agent.md)     | Define an agent and expose it as a streaming chat endpoint.          |
| [Create an API](./create-an-api.md)         | Add an HTTP endpoint with a typed Request and Response.              |
| [Create a frontend](./create-a-frontend.md) | Add a page and a navigation link.                                    |
| [Deploy a project](./deploy-a-project.md)   | Build and ship to Veryfront Cloud or another host.                   |

### Foundations

| Guide                                         | What you will do                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| [Project structure](../guides/project-structure.md)   | Learn the file conventions and how auto-discovery wires your project up.      |
| [Configuration](../guides/configuration.md)           | Configure `veryfront.config.ts`, environment variables, and runtime settings. |
| [Choose a primitive](../guides/choose-a-primitive.md) | Pick the smallest Veryfront primitive that matches the work.                  |
| [Production path](../guides/production-path.md)       | Build one route from local project to production verification.                |

### Pages and APIs

| Guide                                       | What you will do                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| [Pages and routing](../guides/pages-and-routing.md) | Add file-based pages, layouts, dynamic routes, and MDX content.             |
| [Data fetching](../guides/data-fetching.md)         | Load data on the server, prerender static pages, and fetch from the client. |
| [API routes](../guides/api-routes.md)               | Build HTTP handlers with request parsing and streaming responses.           |
| [Middleware](../guides/middleware.md)               | Add CORS, rate limiting, logging, and custom middleware pipelines.          |
| [Head and SEO](../guides/head-and-seo.md)           | Set page metadata, Open Graph tags, and structured data.                    |

### AI primitives

| Guide                                               | What you will do                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Providers](../guides/providers.md)                         | Pick a model provider for local inference, Veryfront Cloud, or a direct vendor. |
| [Agents](../guides/agents.md)                               | Define an agent with a system prompt, tools, and memory.                        |
| [Agent service runtime](../guides/agent-service-runtime.md) | Run agents as separately deployed services.                                     |
| [Tools](../guides/tools.md)                                 | Define typed tools that agents can call.                                        |
| [Memory and streaming](../guides/memory-and-streaming.md)   | Add conversation memory and stream model output to the client.                  |

### Chat UI

| Guide                                     | What you will do                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| [Chat UI](../guides/chat-ui.md)                   | Drop in the preset chat component with one hook and one API route.          |
| [Chat composition](../guides/chat-composition.md) | Build a custom chat layout with the composition components.                 |
| [Chat hooks](../guides/chat-hooks.md)             | Drive chat from headless hooks: chat, agent, completion, voice, and thread. |
| [Chat theming](../guides/chat-theming.md)         | Theme chat features, attachments, sources, models, and visuals.             |

### Orchestration

| Guide                                          | What you will do                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| [Workflows](../guides/workflows.md)                    | Define a DAG-based workflow with branches, retries, and parallel steps. |
| [Workflows: advanced](../guides/workflows-advanced.md) | Loops, blob storage for large artifacts, and React hooks for progress.  |
| [Multi-agent](../guides/multi-agent.md)                | Compose agents with delegation and agent-as-tool patterns.              |
| [Skills](../guides/skills.md)                          | Add project-level skills from `SKILL.md` files with tool restrictions.  |
| [Jobs](../guides/jobs.md)                              | Run one-off jobs, schedule cron jobs, and inspect batch summaries.      |
| [Tasks](../guides/tasks.md)                            | Write background task functions that run locally or as cloud jobs.      |

### External systems

| Guide                                                   | What you will do                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [MCP server](../guides/mcp-server.md)                           | Expose tools, prompts, and resources over Model Context Protocol.                     |
| [Coding agents](../guides/coding-agents.md)                     | Connect Claude Code, Cursor, Codex, and other MCP-aware agents to the dev server.     |
| [OAuth](../guides/oauth.md)                                     | Sign users in with OAuth 2.0 and the built-in provider catalog.                       |
| [Integrations](../guides/integrations.md)                       | Wire config-driven integration tools with OAuth, token management, and API execution. |
| [Sandbox](../guides/sandbox.md)                                 | Run isolated commands and file operations in an ephemeral sandbox session.            |
| [CLI knowledge ingestion](../guides/cli-knowledge-ingestion.md) | Turn uploads and local documents into project knowledge files from the CLI.           |

### Extensions

| Guide                                             | What you will do                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| [Extensions](../guides/extensions.md)                     | Understand how extensions add focused capabilities to a Veryfront project. |
| [Extension authoring](../guides/extension-authoring.md)   | Write a focused extension factory, contract, and capability.               |
| [Extension lifecycle](../guides/extension-lifecycle.md)   | Trace extension discovery, ordering, setup, and teardown.                  |
| [Extension testing](../guides/extension-testing.md)       | Test an extension factory and the contracts it implements.                 |
| [Extension publishing](../guides/extension-publishing.md) | Package and publish a reusable extension.                                  |

### Ship to production

| Guide                                    | What you will do                                                |
| ---------------------------------------- | --------------------------------------------------------------- |
| [Building and deploying](../guides/deploying.md) | Production-build internals, static export, Docker, and targets. |

## Next

Ready to build? Start with [Installation](./installation.md) to set up
the Veryfront CLI, then walk through Getting Started in order.
