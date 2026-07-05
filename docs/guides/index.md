---
title: "Guides"
sidebarTitle: "Overview"
description: "Goal-based guides for building and running Veryfront Code projects."
order: 0
---

Guides are recipes for specific goals. Use them when you know what you want to
build, change, run, or verify.

For concepts and boundaries, see [Concepts](../concepts/index.md). For full API
details, see [API reference](../api-reference/index.md).

## Start a project

| Goal                          | Guide                                         |
| ----------------------------- | --------------------------------------------- |
| Understand where files belong | [Project structure](./project-structure.md)   |
| Configure project behavior    | [Configuration](./configuration.md)           |
| Choose the right primitive    | [Choose a primitive](./choose-a-primitive.md) |

## Build routes

| Goal                                        | Guide                                       |
| ------------------------------------------- | ------------------------------------------- |
| Add pages, layouts, and dynamic routes      | [Pages and routing](./pages-and-routing.md) |
| Load data for pages                         | [Data fetching](./data-fetching.md)         |
| Add HTTP endpoints                          | [API routes](./api-routes.md)               |
| Add CORS, auth checks, logging, or timeouts | [Middleware](./middleware.md)               |
| Set page metadata and social previews       | [Head and SEO](./head-and-seo.md)           |

## Add AI behavior

| Goal                                        | Guide                                             |
| ------------------------------------------- | ------------------------------------------------- |
| Add an agent                                | [Agents](./agents.md)                             |
| Choose model providers and runtime defaults | [Providers](./providers.md)                       |
| Give an agent a typed capability            | [Tools](./tools.md)                               |
| Measure agent behavior with evals           | [Evals](./evals.md)                               |
| Emit app and eval dashboard metrics         | [Project metrics](./project-metrics.md)           |
| Add memory or streamed responses            | [Memory and streaming](./memory-and-streaming.md) |
| Build document Q&A with RAG                 | [Build a RAG app](./build-a-rag-app.md)           |
| Coordinate more than one agent              | [Multi-agent](./multi-agent.md)                   |
| Package reusable agent instructions         | [Skills](./skills.md)                             |

## Build chat

| Goal                                  | Guide                           |
| ------------------------------------- | ------------------------------- |
| Add a preset or custom chat interface | [Build a chat UI](./chat-ui.md) |
| Use headless chat state               | [Chat hooks](./chat-hooks.md)   |

## Run background work

| Goal                                       | Guide                                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| Define reusable background work            | [Tasks](./tasks.md)                                     |
| Coordinate multi-step work                 | [Workflows](./workflows.md)                             |
| Add loops, large artifacts, or progress UI | [Workflows: advanced](./workflows-advanced.md)          |
| Run durable work                           | [Runs](./runs.md)                                       |
| Ingest documents into project knowledge    | [CLI knowledge ingestion](./cli-knowledge-ingestion.md) |

## Connect external systems

| Goal                                               | Guide                               |
| -------------------------------------------------- | ----------------------------------- |
| Sign users in with OAuth                           | [OAuth](./oauth.md)                 |
| Add connector-backed service tools                 | [Integrations](./integrations.md)   |
| Expose tools, prompts, and resources to assistants | [MCP server](./mcp-server.md)       |
| Connect coding agents to the dev server            | [Coding agents](./coding-agents.md) |
| Run isolated commands or file operations           | [Sandbox](./sandbox.md)             |

## Deploy and extend

| Goal                                   | Guide                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| Build and deploy a project             | [Build and deploy](./deploying.md)                    |
| Review shipped UI components           | [Storybook UI workbench](./storybook-ui-workbench.md) |
| Run agents as separate services        | [Agent service runtime](./agent-service-runtime.md)   |
| Enable reusable runtime infrastructure | [Extensions](./extensions.md)                         |
| Write, test, and package an extension  | [Author extensions](./extension-authoring.md)         |
