---
title: "MCP server"
description: "How MCP servers expose tools, prompts, and resources to assistants."
order: 28
---

An MCP server owns an assistant-facing protocol surface. It exposes tools,
prompts, and resources through MCP.

Use an MCP server when an assistant needs to inspect or operate on a project
through a protocol, not through app routes. MCP is not the same as AG-UI or REST.

MCP describes capabilities for assistants. App routes describe entry points for
users and HTTP clients.

For implementation steps, see [MCP server](../guides/mcp-server.md).
