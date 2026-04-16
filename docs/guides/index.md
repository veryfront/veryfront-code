---
title: "Guides"
description: "Learn Veryfront Code — pages, routing, AI agents, and deployment."
order: 0
---

# Guides

Learn Veryfront Code from the ground up: pages, routing, AI agents, and deployment.

## Getting Started

| Guide                         | Description                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| [Quickstart](./quickstart.md) | Install, create a project, and run the dev server in under 2 minutes. |

## Basics

| Guide                                       | Description                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| [Project Structure](./project-structure.md) | File conventions, directory layout, and how auto-discovery works. |
| [Pages & Routing](./pages-and-routing.md)   | File-based routing, layouts, dynamic routes, and MDX pages.       |
| [Data Fetching](./data-fetching.md)         | Server data, static generation, and client-side fetching.         |
| [API Routes](./api-routes.md)               | HTTP handlers, request parsing, and streaming responses.          |

## AI

| Guide                                                   | Description                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Agents](./agents.md)                                   | Create an AI agent with a system prompt, tools, and memory.                         |
| [CLI Knowledge Ingestion](./cli-knowledge-ingestion.md) | Turn uploads and local documents into project knowledge files with one CLI command. |
| [Tools](./tools.md)                                     | Define tools with Zod schemas that agents can call.                                 |
| [Memory & Streaming](./memory-and-streaming.md)         | Conversation memory strategies and streaming responses.                             |
| [Chat UI](./chat-ui.md)                                 | Pre-built chat components and React hooks for chat interfaces.                      |
| [Workflows](./workflows.md)                             | DAG-based multi-step workflows with branching and parallelism.                      |
| [Multi-Agent](./multi-agent.md)                         | Agent composition, delegation, and agent-as-tool patterns.                          |

## Infrastructure

| Guide                              | Description                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Jobs & Cron Jobs](./jobs.md)      | Create one-off jobs, schedule cron jobs, inspect events, and work with batch summaries.           |
| [Providers](./providers.md)        | Unified model interface for local, Veryfront Cloud, and direct provider runtimes.                 |
| [Middleware](./middleware.md)      | CORS, rate limiting, logging, and custom middleware pipelines.                                    |
| [OAuth](./oauth.md)                | OAuth 2.0 helpers with a built-in provider catalog.                                               |
| [MCP Server](./mcp-server.md)      | Expose tools, prompts, and resources over Model Context Protocol.                                 |
| [Sandbox](./sandbox.md)            | Run isolated commands and file operations in ephemeral sandbox sessions.                          |
| [Integrations](../integrations.md) | Config-driven integration tools with OAuth, token management, and API execution across the built-in connector catalog. |

## Production

| Guide                                  | Description                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [Configuration](./configuration.md)    | `veryfront.config.ts` options, environment variables, and runtime settings. |
| [Building & Deploying](./deploying.md) | Production builds, static export, and deployment targets.                   |
| [Head & SEO](./head-and-seo.md)        | Declarative metadata, Open Graph, and structured data.                      |
