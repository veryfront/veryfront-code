---
title: "MCP server"
description: "How MCP servers expose tools, prompts, and resources to assistants."
order: 31
---

An MCP server owns an assistant-facing protocol surface. It exposes tools,
prompts, and resources through MCP.

MCP servers exist because assistants need a protocol surface that is not the same
as a user-facing app route. MCP describes capabilities an assistant can inspect
and call.

## Characteristics

- Tools expose actions.
- Prompts expose reusable instructions.
- Resources expose readable context.
- Transport defines how the assistant connects.
- Auth decides which clients can use the server.

## Boundary

MCP describes capabilities for assistants. App routes describe entry points for
users and HTTP clients.

Use an MCP server when an assistant needs to inspect or operate on a project
through a protocol. MCP is not the same as AG-UI or REST. AG-UI streams agent
output to app clients. MCP exposes tools, prompts, and resources to assistants.

Provider MCP servers can be useful remote tool sources, but production
integrations may still route through Veryfront's integration layer when the
agent-facing surface needs product policy, cross-system workflow context, or
write-action governance. Salesforce follows that model; see
[Salesforce integration](./salesforce-integration.md).

## Wrong fit

Do not use MCP as the public API for normal app users. Use app routes or API
routes for user-facing HTTP entry points.

For implementation steps, see [MCP server](../guides/mcp-server.md).
