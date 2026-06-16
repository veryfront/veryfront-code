---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 13
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

Create mcpserver.

**Returns:** `MCPServer`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildFormElicitation` | Builds form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L21) |
| `buildUrlElicitation` | Builds URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L35) |
| `clearMCPRegistry` | Clear MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L43) |
| `createMCPServer` | Create mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L847) |
| `formatSSEEvent` | Stateless SSE formatting utilities per the Server-Sent Events standard. Used by the Streamable HTTP transport for MCP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L6) |
| `formatSSEPrimingEvent` | Event emitted for format ssepriming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L19) |
| `formatSSERetry` | Formats sseretry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L14) |
| `getMCPRegistry` | Return MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L10) |
| `getMCPStats` | Return MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L34) |
| `registerPrompt` | Registers prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L29) |
| `registerResource` | Registers resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L24) |
| `registerTool` | Registers tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L19) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MCPServer` | Implement mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L101) |
| `SessionManager` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts#L21) |
| `TaskStore` | Implement task store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L18) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ElicitationRequest` | Request payload for elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L15) |
| `FormElicitationOptions` | Options accepted by form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L2) |
| `IntegrationLoaderConfig` | Configuration used by integration loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L92) |
| `MCPServerConfig` | Configuration used by mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L59) |
| `MCPStats` | Public API contract for MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L61) |
| `MCPTool` | Generic MCP tool definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L12) |
| `Task` | Public API contract for task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L2) |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts#L5) |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L24) |
| `UrlElicitationOptions` | Options accepted by URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L8) |
