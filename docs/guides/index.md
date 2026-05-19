---
title: "Guides"
description: "Goal-oriented tutorials for building Veryfront apps, agents, workflows, and integrations with the Veryfront library and CLI."
order: 0
---

# Guides

Each guide helps you complete one goal with the Veryfront library or CLI.
Pick the guide that matches what you want to do next.

If you are new, start at [Get started](#get-started) and walk through the
guides in order. If you already have a project, jump to the section that
matches your goal.

## Get started

| Guide                                         | What you will do                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| [Quickstart](./quickstart.md)                 | Install Veryfront, create a project, and run the dev server.                  |
| [Choose a primitive](./choose-a-primitive.md) | Pick the smallest Veryfront primitive that matches the work.                  |
| [Project structure](./project-structure.md)   | Learn the file conventions and how auto-discovery wires your project up.      |
| [Configuration](./configuration.md)           | Configure `veryfront.config.ts`, environment variables, and runtime settings. |

## Build pages and APIs

| Guide                                       | What you will do                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| [Pages and routing](./pages-and-routing.md) | Add file-based pages, layouts, dynamic routes, and MDX content.             |
| [Data fetching](./data-fetching.md)         | Load data on the server, prerender static pages, and fetch from the client. |
| [API routes](./api-routes.md)               | Build HTTP handlers with request parsing and streaming responses.           |
| [Middleware](./middleware.md)               | Add CORS, rate limiting, logging, and custom middleware pipelines.          |
| [Head and SEO](./head-and-seo.md)           | Set page metadata, Open Graph tags, and structured data.                    |

## Add an AI agent

| Guide                                               | What you will do                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Providers](./providers.md)                         | Pick a model provider for local inference, Veryfront Cloud, or a direct vendor. |
| [Agents](./agents.md)                               | Define an agent with a system prompt, tools, and memory.                        |
| [Agent service runtime](./agent-service-runtime.md) | Run agents as separately deployed services.                                     |
| [Tools](./tools.md)                                 | Define typed tools that agents can call.                                        |
| [Memory and streaming](./memory-and-streaming.md)   | Add conversation memory and stream model output to the client.                  |

## Build a chat UI

| Guide                                     | What you will do                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| [Chat UI](./chat-ui.md)                   | Drop in the preset chat component with one hook and one API route.          |
| [Chat composition](./chat-composition.md) | Build a custom chat layout with the composition components.                 |
| [Chat hooks](./chat-hooks.md)             | Drive chat from headless hooks: chat, agent, completion, voice, and thread. |
| [Chat theming](./chat-theming.md)         | Theme chat features, attachments, sources, models, and visuals.             |

## Orchestrate work across agents and time

| Guide                           | What you will do                                                        |
| ------------------------------- | ----------------------------------------------------------------------- |
| [Workflows](./workflows.md)     | Define a DAG-based workflow with branches, retries, and parallel steps. |
| [Multi-agent](./multi-agent.md) | Compose agents with delegation and agent-as-tool patterns.              |
| [Skills](./skills.md)           | Add project-level skills from `SKILL.md` files with tool restrictions.  |
| [Jobs](./jobs.md)               | Run one-off jobs, schedule cron jobs, and inspect batch summaries.      |
| [Tasks](./tasks.md)             | Write background task functions that run locally or as cloud jobs.      |

## Connect external systems

| Guide                                                   | What you will do                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [MCP server](./mcp-server.md)                           | Expose tools, prompts, and resources over Model Context Protocol.                     |
| [OAuth](./oauth.md)                                     | Sign users in with OAuth 2.0 and the built-in provider catalog.                       |
| [Integrations](./integrations.md)                       | Wire config-driven integration tools with OAuth, token management, and API execution. |
| [Sandbox](./sandbox.md)                                 | Run isolated commands and file operations in an ephemeral sandbox session.            |
| [CLI knowledge ingestion](./cli-knowledge-ingestion.md) | Turn uploads and local documents into project knowledge files from the CLI.           |

## Extend Veryfront

| Guide                                             | What you will do                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| [Extensions](./extensions.md)                     | Understand how extensions add focused capabilities to a Veryfront project. |
| [Extension authoring](./extension-authoring.md)   | Write a focused extension factory, contract, and capability.               |
| [Extension lifecycle](./extension-lifecycle.md)   | Trace extension discovery, ordering, setup, and teardown.                  |
| [Extension testing](./extension-testing.md)       | Test an extension factory and the contracts it implements.                 |
| [Extension publishing](./extension-publishing.md) | Package and publish a reusable extension.                                  |

## Ship to production

| Guide                                    | What you will do                                                |
| ---------------------------------------- | --------------------------------------------------------------- |
| [Building and deploying](./deploying.md) | Build for production, configure static export, and pick a host. |
