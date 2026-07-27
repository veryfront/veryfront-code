---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 16
---

## Import

```ts
import {
  createMCPServer,
  registerTool,
  registerPrompt,
  registerResource,
  buildFormElicitation,
  buildUrlElicitation,
} from "veryfront/mcp";
```

## Examples

```ts
import { createMCPServer } from "veryfront/mcp";
import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

// Tools auto-register with MCP when defined
tool({
  id: "search",
  description: "Search docs",
  inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
  execute: async ({ query }) => ({ results: [] }),
});

// Start MCP server - registered tools are exposed automatically.
// `auth` is required: use bearer for production, or the explicit
// `{ type: "none", allowUnauthenticated: true }` opt-in for local dev only.
const server = createMCPServer({
  enabled: true,
  auth: { type: "none", allowUnauthenticated: true },
});
```

## API

### `createMCPServer(config)`

Create an application-facing MCP server from validated configuration.

**Returns:** `MCPServer`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildFormElicitation` | Builds form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L465) |
| `buildUrlElicitation` | Builds URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L497) |
| `clearMCPRegistry` | Clear MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L46) |
| `createMCPServer` | Create an application-facing MCP server from validated configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L1544) |
| `formatSSEEvent` | Format bounded JSON data as one optional-ID SSE event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L17) |
| `formatSSEPrimingEvent` | Format an empty SSE event that advances the event ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L41) |
| `formatSSERetry` | Format an SSE reconnection delay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L33) |
| `getMCPRegistry` | Return MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L10) |
| `getMCPStats` | Return MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L37) |
| `registerPrompt` | Registers prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L32) |
| `registerResource` | Registers resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L24) |
| `registerTool` | Registers tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L19) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MCPServer` | Exposes registered tools, resources, and prompts through MCP dispatch and the built-in session-based HTTP transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L372) |
| `SessionManager` | Owns bounded, inactivity-expiring MCP session identifiers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts#L28) |
| `TaskStore` | Stores bounded, optionally session-scoped MCP task state and results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L60) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ElicitationRequest` | Request payload for elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L459) |
| `FormElicitationOptions` | Options accepted by form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L446) |
| `MCPServerConfig` | Configuration used by mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L68) |
| `MCPStats` | Public API contract for MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L70) |
| `MCPTool` | Generic MCP tool definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L12) |
| `Task` | Public API contract for task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L2) |
| `TaskPage` | A bounded page of task metadata and its optional continuation cursor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L23) |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts#L5) |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L24) |
| `UrlElicitationOptions` | Options accepted by URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L452) |
