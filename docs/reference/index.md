---
title: "Veryfront Code API reference"
description: "Public import surfaces for Veryfront Code."
order: 0
---

# Veryfront Code API reference

Public import surfaces for Veryfront Code. The package name and import surface remain `veryfront`.

## Install

```bash
npm install veryfront
```

## Modules

| Import                                          | Description                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| [`veryfront`](./root.md)                        | Configuration, server bootstrap, routing, data fetching, and input validation. |
| [`veryfront/head`](./head.md)                   | Document metadata management.                                                  |
| [`veryfront/router`](./router.md)               | Client-side routing, navigation, and links.                                    |
| [`veryfront/context`](./context.md)             | Route params, page data, and MDX frontmatter context.                          |
| [`veryfront/fonts`](./fonts.md)                 | Google Fonts loading helpers.                                                  |
| [`veryfront/chat`](./chat.md)                   | Chat UI components and streaming hooks.                                        |
| [`veryfront/markdown`](./markdown.md)           | Markdown rendering with syntax highlighting and diagrams.                      |
| [`veryfront/mdx`](./mdx.md)                     | Component overrides for `.mdx` page rendering.                                 |
| [`veryfront/agent`](./agent.md)                 | AI agents, runtime handlers, tools, memory, and composition.                   |
| [`veryfront/tool`](./tool.md)                   | Tool definitions for agents and MCP.                                           |
| [`veryfront/workflow`](./workflow.md)           | Step graphs, branching, parallelism, waits, and workflow clients.              |
| [`veryfront/prompt`](./prompt.md)               | Prompt declarations for MCP and agent runtimes.                                |
| [`veryfront/resource`](./resource.md)           | Resource declarations for MCP.                                                 |
| [`veryfront/jobs`](./jobs.md)                   | Project-scoped jobs, cron jobs, batches, events, and logs.                     |
| [`veryfront/mcp`](./mcp.md)                     | MCP server exposing tools, prompts, and resources.                             |
| [`veryfront/middleware`](./middleware.md)       | CORS, rate limiting, logging, timeout, and middleware composition.             |
| [`veryfront/observability`](./observability.md) | Tracing, metrics, instrumentation, and OTLP setup helpers.                     |
| [`veryfront/utils`](./utils.md)                 | Shared runtime utilities.                                                      |
| [`veryfront/oauth`](./oauth.md)                 | OAuth handlers, provider configs, token storage, and status helpers.           |
| [`veryfront/provider`](./provider.md)           | Model provider registry and Veryfront Cloud model helpers.                     |
| [`veryfront/fs`](./fs.md)                       | Filesystem, path, and cwd utilities.                                           |
| [`veryfront/integrations`](./integrations.md)   | Integration metadata, connector catalog helpers, and icons.                    |
| [`veryfront/sandbox`](./sandbox.md)             | Ephemeral sandbox sessions and command execution.                              |
| [`veryfront/embedding`](./embedding.md)         | RAG primitives for chunking, embeddings, and similarity search.                |
| [`veryfront/extensions`](./extensions.md)       | Extension authoring and runtime orchestration APIs.                            |
| [`veryfront/testing`](./testing.md)             | Cross-runtime assertions, BDD helpers, and test utilities.                     |
| [`veryfront/cli`](./cli.md)                     | Veryfront CLI entry point.                                                     |
| [`veryfront/server`](./server.md)               | Composable service server API.                                                 |

## Deep export policy

Reference pages cover top-level public import surfaces. Deep public exports, such as `veryfront/chat/protocol` or `veryfront/workflow/worker`, stay documented through their parent module unless they need a dedicated host-integration guide.

## Host integration references

- [Agent hosted lifecycle](./agent-hosted-lifecycle.md) covers generic durable hosted run lifecycle helpers.
- [Conversation-backed agent hosts](./agent-conversation-control-plane.md) covers control-plane host composition.
- [Agent runtime AG-UI](./agent-runtime-ag-ui.md) covers package-hosted AG-UI runtime contracts and endpoint conventions.
- [Agent service runtime](./agent-service-runtime.md) covers separately deployed agent services.
- [Agent tooling and runtime state](./agent-tooling.md) covers tool allowlists, provider-native tool discovery, and runtime state hooks.
- [Skills](../guides/skills.md) covers project-level `SKILL.md` capabilities. Skills are configured through agent discovery and `agent({ skills })`; there is no top-level `veryfront/skill` import path.
