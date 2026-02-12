---
title: "Guides"
description: "Learn Veryfront from the ground up — pages, routing, AI agents, and production deployment."
order: 0
---

Learn Veryfront from the ground up. Each guide builds on the previous, so reading in order is recommended.

## Getting Started

| Guide | Description |
|-------|-------------|
| [Quickstart](./quickstart.md) | Install, create a project, and run the dev server in under 2 minutes. |

## Basics

| Guide | Description |
|-------|-------------|
| [Project Structure](./project-structure.md) | File conventions, directory layout, and how auto-discovery works. |
| [Pages & Routing](./pages-and-routing.md) | File-based routing, layouts, dynamic routes, and MDX pages. |
| [Data Fetching](./data-fetching.md) | Server data, static generation, and client-side fetching. |
| [API Routes](./api-routes.md) | HTTP handlers, request parsing, and streaming responses. |

## AI

| Guide | Description |
|-------|-------------|
| [Agents](./agents.md) | Create an AI agent with a system prompt, tools, and memory. |
| [Tools](./tools.md) | Define tools with Zod schemas that agents can call. |
| [Memory & Streaming](./memory-and-streaming.md) | Conversation memory strategies and streaming responses. |
| [Chat UI](./chat-ui.md) | Pre-built chat components and React hooks for AI interfaces. |
| [Workflows](./workflows.md) | DAG-based multi-step workflows with branching and parallelism. |
| [Multi-Agent](./multi-agent.md) | Agent composition, delegation, and agent-as-tool patterns. |

## Infrastructure

| Guide | Description |
|-------|-------------|
| [Providers](./providers.md) | Unified LLM interface for OpenAI, Anthropic, and Google. |
| [Middleware](./middleware.md) | CORS, rate limiting, logging, and custom middleware pipelines. |
| [OAuth](./oauth.md) | OAuth 2.0 with 37 pre-configured providers. |
| [MCP Server](./mcp-server.md) | Expose tools, prompts, and resources over Model Context Protocol. |

## Production

| Guide | Description |
|-------|-------------|
| [Configuration](./configuration.md) | `veryfront.config.ts` options, environment variables, and runtime settings. |
| [Building & Deploying](./deploying.md) | Production builds, static export, and deployment targets. |
| [Head & SEO](./head-and-seo.md) | Declarative metadata, Open Graph, and structured data. |
