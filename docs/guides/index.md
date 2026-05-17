---
title: "Guides"
description: "Learn Veryfront Code: pages, routing, AI agents, and deployment."
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
| [Tools](./tools.md)                                     | Define tools with Zod schemas that agents can call.                                 |
| [Memory & Streaming](./memory-and-streaming.md)         | Conversation memory strategies and streaming responses.                             |
| [Chat UI](./chat-ui.md)                                 | Use the preset chat component with one hook and one API route.                      |
| [Chat Composition](./chat-composition.md)               | Build custom chat layouts with composition components.                              |
| [Chat Hooks](./chat-hooks.md)                           | Use headless chat, agent, completion, voice, and thread hooks.                      |
| [Chat Theming](./chat-theming.md)                       | Customize chat features, attachments, sources, models, and visual styling.          |
| [Workflows](./workflows.md)                             | DAG-based multi-step workflows with branching and parallelism.                      |
| [Multi-Agent](./multi-agent.md)                         | Agent composition, delegation, and agent-as-tool patterns.                          |
| [Skills](./skills.md)                                   | Project-level agent capabilities as SKILL.md files with tool restrictions.          |
| [CLI Knowledge Ingestion](./cli-knowledge-ingestion.md) | Turn uploads and local documents into project knowledge files with one CLI command. |

## Infrastructure

| Guide                                             | Description                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Jobs & Cron Jobs](./jobs.md)                     | Create one-off jobs, schedule cron jobs, inspect events, and work with batch summaries. |
| [Tasks](./tasks.md)                               | Define background task functions that run locally or as cloud jobs.                     |
| [Providers](./providers.md)                       | Unified model interface for local, Veryfront Cloud, and direct provider runtimes.       |
| [Middleware](./middleware.md)                     | CORS, rate limiting, logging, and custom middleware pipelines.                          |
| [OAuth](./oauth.md)                               | OAuth 2.0 helpers with a built-in provider catalog.                                     |
| [MCP Server](./mcp-server.md)                     | Expose tools, prompts, and resources over Model Context Protocol.                       |
| [Sandbox](./sandbox.md)                           | Run isolated commands and file operations in ephemeral sandbox sessions.                |
| [Integrations](./integrations.md)                 | Config-driven integration tools with OAuth, token management, and API execution.        |
| [Extensions](./extensions.md)                     | Understand how extensions add focused capabilities to Veryfront.                        |
| [Extension Authoring](./extension-authoring.md)   | Write focused extension factories, contracts, and capabilities.                         |
| [Extension Lifecycle](./extension-lifecycle.md)   | Understand extension discovery, ordering, setup, and teardown.                          |
| [Extension Testing](./extension-testing.md)       | Test extension factories and contract implementations.                                  |
| [Extension Publishing](./extension-publishing.md) | Package and publish reusable extensions.                                                |

## Production

| Guide                                  | Description                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [Configuration](./configuration.md)    | `veryfront.config.ts` options, environment variables, and runtime settings. |
| [Building & Deploying](./deploying.md) | Production builds, static export, and deployment targets.                   |
| [Head & SEO](./head-and-seo.md)        | Declarative metadata, Open Graph, and structured data.                      |
