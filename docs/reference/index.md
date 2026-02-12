---
title: "Framework API Reference"
description: "Complete API reference for the Veryfront framework."
order: 0
---

Complete API reference for the Veryfront framework.

## Install

```bash
npm install veryfront
```

## Modules

| Import | Description |
|--------|-------------|
| [`veryfront`](./root.md) | Configuration, server bootstrap, routing, data fetching, and input validation. |
| [`veryfront/head`](./head.md) | Declarative `<head>` metadata management. |
| [`veryfront/router`](./router.md) | Client-side routing, navigation, and links. |
| [`veryfront/context`](./context.md) | Access route params, page data, and MDX frontmatter. |
| [`veryfront/fonts`](./fonts.md) | Load Google Fonts as a React component. |
| [`veryfront/chat`](./chat.md) | Chat UI components and streaming hooks. |
| [`veryfront/markdown`](./markdown.md) | Markdown rendering with syntax highlighting and diagrams. |
| [`veryfront/mdx`](./mdx.md) | Component overrides for `.mdx` page rendering. |
| [`veryfront/agent`](./agent.md) | AI agents with memory, tools, and multi-agent composition. |
| [`veryfront/tool`](./tool.md) | Define tools with Zod schemas for agents and MCP. |
| [`veryfront/workflow`](./workflow.md) | DAG-based agentic workflows with human-in-the-loop support. |
| [`veryfront/prompt`](./prompt.md) | Declare and register prompts exposable over MCP. |
| [`veryfront/resource`](./resource.md) | Declare and register resources exposable over MCP. |
| [`veryfront/mcp`](./mcp.md) | MCP server exposing tools, prompts, and resources. |
| [`veryfront/middleware`](./middleware.md) | CORS, rate limiting, logging, and timeout middleware. |
| [`veryfront/oauth`](./oauth.md) | OAuth 2.0 with 37 pre-configured providers. |
| [`veryfront/provider`](./provider.md) | Unified LLM interface for Anthropic, Google, and OpenAI. |
| [`veryfront/fs`](./fs.md) | Filesystem operations and path utilities. |
| [`veryfront/integrations`](./integrations.md) | Integration metadata and SVG icons for all connectors. |
