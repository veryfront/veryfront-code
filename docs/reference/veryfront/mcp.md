---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 15
---

# veryfront/mcp

MCP server exposing tools, prompts, and resources.

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

// Start MCP server — registered tools are exposed automatically.
// `auth` is required: use bearer for production, or the explicit
// `{ type: "none", allowUnauthenticated: true }` opt-in for local dev only.
const server = createMCPServer({
  enabled: true,
  auth: { type: "none", allowUnauthenticated: true },
});
```

## API

### `createMCPServer(config)`

Create MCP server

**Returns:** `MCPServer`

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildFormElicitation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L16) |
| `buildUrlElicitation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L29) |
| `clearMCPRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L36) |
| `createMCPServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L787) |
| `formatSSEEvent` | Stateless SSE formatting utilities per the Server-Sent Events standard. Used by the Streamable HTTP transport for MCP. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L5) |
| `formatSSEPrimingEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L16) |
| `formatSSERetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts#L12) |
| `getMCPRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L8) |
| `getMCPStats` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L28) |
| `registerPrompt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L24) |
| `registerResource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L20) |
| `registerTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts#L16) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MCPServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L95) |
| `SessionManager` | Manages MCP sessions for the Streamable HTTP transport. Sessions are created during initialization and validated on subsequent requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts#L4) |
| `TaskStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts#L15) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ElicitationRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L11) |
| `FormElicitationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts) |
| `IntegrationLoaderConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts#L87) |
| `MCPServerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L57) |
| `MCPStats` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts#L58) |
| `MCPTool` | Generic MCP tool definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L11) |
| `Task` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts) |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts#L4) |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts#L23) |
| `UrlElicitationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts#L5) |

## Related

Reference modules:

- [`veryfront/tool`](./tool.md): Define tools for MCP
- [`veryfront/prompt`](./prompt.md): Define prompts for MCP
- [`veryfront/resource`](./resource.md): Define resources for MCP

User guides:

- [mcp-server](../../guides/mcp-server.md): Build and host MCP servers

Architecture:

- [10-mcp-runtime](../../architecture/10-mcp-runtime.md): MCP runtime architecture
