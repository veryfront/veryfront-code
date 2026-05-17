---
title: "Guides"
description: "Build Veryfront applications with pages, routing, AI agents, workflows, integrations, and deployment."
order: 0
---

# Guides

Use these guides to build Veryfront applications, from project setup through
runtime capabilities and deployment.

## Getting started

| Guide                                       | Description                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| [Quickstart](./quickstart.md)               | Install, create a project, and run the dev server in under 2 minutes.       |
| [Project structure](./project-structure.md) | File conventions, directory layout, and how auto-discovery works.           |
| [Configuration](./configuration.md)         | `veryfront.config.ts` options, environment variables, and runtime settings. |

## Core app

| Guide                                       | Description                                                    |
| ------------------------------------------- | -------------------------------------------------------------- |
| [Pages and routing](./pages-and-routing.md) | File-based routing, layouts, dynamic routes, and MDX pages.    |
| [Data fetching](./data-fetching.md)         | Server data, static generation, and client-side fetching.      |
| [API routes](./api-routes.md)               | HTTP handlers, request parsing, and streaming responses.       |
| [Middleware](./middleware.md)               | CORS, rate limiting, logging, and custom middleware pipelines. |
| [Head and SEO](./head-and-seo.md)           | Declarative metadata, Open Graph, and structured data.         |

## AI runtime

| Guide                                               | Description                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Providers](./providers.md)                         | Unified model interface for local, Veryfront Cloud, and direct provider runtimes. |
| [Agents](./agents.md)                               | Create an AI agent with a system prompt, tools, and memory.                       |
| [Agent service runtime](./agent-service-runtime.md) | Run Veryfront agents as separately deployed services.                             |
| [Tools](./tools.md)                                 | Define tools with Zod schemas that agents can call.                               |
| [Memory and streaming](./memory-and-streaming.md)   | Conversation memory strategies and streaming responses.                           |
| [Chat UI](./chat-ui.md)                             | Use the preset chat component with one hook and one API route.                    |
| [Chat composition](./chat-composition.md)           | Build custom chat layouts with composition components.                            |
| [Chat hooks](./chat-hooks.md)                       | Use headless chat, agent, completion, voice, and thread hooks.                    |
| [Chat theming](./chat-theming.md)                   | Customize chat features, attachments, sources, models, and visual styling.        |

## Orchestration

| Guide                           | Description                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| [Workflows](./workflows.md)     | DAG-based multi-step workflows with branching and parallelism.                          |
| [Multi-agent](./multi-agent.md) | Agent composition, delegation, and agent-as-tool patterns.                              |
| [Skills](./skills.md)           | Project-level agent capabilities as SKILL.md files with tool restrictions.              |
| [Jobs and cron jobs](./jobs.md) | Create one-off jobs, schedule cron jobs, inspect events, and work with batch summaries. |
| [Tasks](./tasks.md)             | Define background task functions that run locally or as cloud jobs.                     |

## Protocols and integrations

| Guide                                                         | Description                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [MCP server](./mcp-server.md)                                 | Expose tools, prompts, and resources over Model Context Protocol.                   |
| [OAuth](./oauth.md)                                           | OAuth 2.0 helpers with a built-in provider catalog.                                 |
| [Integrations](./integrations.md)                             | Config-driven integration tools with OAuth, token management, and API execution.    |
| [Sandbox](./sandbox.md)                                       | Run isolated commands and file operations in ephemeral sandbox sessions.            |
| [CLI-first knowledge ingestion](./cli-knowledge-ingestion.md) | Turn uploads and local documents into project knowledge files with one CLI command. |

## Extensibility

| Guide                                             | Description                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [Extensions](./extensions.md)                     | Understand how extensions add focused capabilities to Veryfront. |
| [Extension authoring](./extension-authoring.md)   | Write focused extension factories, contracts, and capabilities.  |
| [Extension lifecycle](./extension-lifecycle.md)   | Understand extension discovery, ordering, setup, and teardown.   |
| [Extension testing](./extension-testing.md)       | Test extension factories and contract implementations.           |
| [Extension publishing](./extension-publishing.md) | Package and publish reusable extensions.                         |

## Production

| Guide                                    | Description                                               |
| ---------------------------------------- | --------------------------------------------------------- |
| [Building and deploying](./deploying.md) | Production builds, static export, and deployment targets. |
