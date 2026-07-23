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
import { defineSchema } from "veryfront/schemas";

// Tools auto-register with MCP when defined
tool({
  id: "search",
  description: "Search docs",
  inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
  execute: async ({ query }) => ({ results: [] }),
});

// Start the MCP server. Registered tools are exposed automatically.
// `auth` is required: use bearer for production, or the explicit
// `{ type: "none", allowUnauthenticated: true }` opt-in for local dev only.
const server = createMCPServer({
  enabled: true,
  auth: { type: "none", allowUnauthenticated: true },
});
```

## API

### `createMCPServer(config)`

Creates a Veryfront MCP protocol server.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `enabled` | `boolean` | Enable the MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L96) |
| `port?` | `number` | HTTP port used by the MCP server when configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L98) |
| `auth` | `MCPAuthConfig` | Authentication policy enforced for every request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L100) |
| `cors?` | <code>&#123; enabled: boolean; origins?: string[] &#125;</code> | Cross-origin policy for the HTTP transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L102) |

**Returns:** `MCPServer`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildFormElicitation` | Build a form-mode elicitation request with a restricted flat schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L529) |
| `buildUrlElicitation` | Build a URL-mode elicitation request without embedded credentials. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L547) |
| `clearMCPRegistry` | Clear MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L43) |
| `createMCPServer` | Creates a Veryfront MCP protocol server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L1338) |
| `formatSSEEvent` | Format a bounded JSON value as one Server-Sent Events data event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L43) |
| `formatSSEPrimingEvent` | Creates an SSE priming event for connection setup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L66) |
| `formatSSERetry` | Formats an SSE reconnection delay directive. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L54) |
| `getMCPRegistry` | Return MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L10) |
| `getMCPStats` | Return MCP stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L34) |
| `registerPrompt` | Registers prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L29) |
| `registerResource` | Registers resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L24) |
| `registerTool` | Registers tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L19) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MCPServer` | Implements the Veryfront MCP protocol server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L288) |
| `SessionManager` | Bounded inactivity-based session store for the Streamable HTTP transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts#L31) |
| `TaskStore` | In-memory MCP task state with bounded retention and immutable reads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L62) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ElicitationRequest` | Request payload for elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L22) |
| `FormElicitationOptions` | Options accepted by form elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L4) |
| `JSONRPCParams` | Parameters accepted by an MCP JSON-RPC method. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L14) |
| `JSONRPCRequest` | JSON-RPC request accepted by the in-process MCP dispatcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L211) |
| `JSONRPCResponse` | JSON-RPC response returned by the in-process MCP dispatcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L223) |
| `MCPAuthConfig` | Authentication configuration accepted by the MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L83) |
| `MCPInputSchema` | Minimal schema contract required by an MCP tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L8) |
| `MCPRequestContext` | Request-scoped context accepted by MCP tool and prompt operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L17) |
| `MCPServerConfig` | Configuration used by the MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L94) |
| `MCPStats` | Counts of primitives currently visible through the MCP registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L109) |
| `MCPTool` | Generic MCP tool definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L32) |
| `Task` | Public API contract for task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L4) |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts#L5) |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L50) |
| `UrlElicitationOptions` | Options accepted by URL elicitation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L12) |
