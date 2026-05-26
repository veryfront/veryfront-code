---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 15
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
import { z } from "zod";

// Tools auto-register with MCP when defined
tool({
  id: "search",
  description: "Search docs",
  inputSchema: z.object({ query: z.string() }),
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
| `buildFormElicitation` | Builds form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L20) |
| `buildUrlElicitation` | Builds URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L34) |
| `clearMCPRegistry` | Clear MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L42) |
| `createMCPServer` | Create mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L783) |
| `formatSSEEvent` | Stateless SSE formatting utilities per the Server-Sent Events standard. Used by the Streamable HTTP transport for MCP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L5) |
| `formatSSEPrimingEvent` | Event emitted for format ssepriming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L18) |
| `formatSSERetry` | Formats sseretry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L13) |
| `getMCPRegistry` | Return MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L9) |
| `getMCPStats` | Return MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L33) |
| `registerPrompt` | Registers prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L28) |
| `registerResource` | Registers resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L23) |
| `registerTool` | Registers tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L18) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MCPServer` | Implement mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L96) |
| `SessionManager` | Manages MCP sessions for the Streamable HTTP transport. Sessions are created during initialization and validated on subsequent requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts#L4) |
| `TaskStore` | Implement task store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L17) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ElicitationRequest` | Request payload for elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L14) |
| `FormElicitationOptions` | Options accepted by form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L1) |
| `IntegrationLoaderConfig` | Configuration used by integration loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L87) |
| `MCPServerConfig` | Configuration used by mcpserver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L58) |
| `MCPStats` | Public API contract for MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L60) |
| `MCPTool` | Generic MCP tool definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L11) |
| `Task` | Public API contract for task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L1) |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts#L4) |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L23) |
| `UrlElicitationOptions` | Options accepted by URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L7) |
