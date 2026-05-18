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

| Name | Description |
|------|-------------|
| `buildFormElicitation` |  |
| `buildUrlElicitation` |  |
| `clearMCPRegistry` | Clear all registries |
| `createMCPServer` | Create MCP server |
| `formatSSEEvent` | Stateless SSE formatting utilities per the Server-Sent Events standard. |
| `formatSSEPrimingEvent` |  |
| `formatSSERetry` |  |
| `getMCPRegistry` | Get tool/prompt/resource registry |
| `getMCPStats` | Get registered capability stats |
| `registerPrompt` | Register prompt with MCP |
| `registerResource` | Register resource with MCP |
| `registerTool` | Register tool with MCP |

### Classes

| Name | Description |
|------|-------------|
| `MCPServer` | MCP server instance |
| `SessionManager` | Manages MCP sessions for the Streamable HTTP transport. |
| `TaskStore` |  |

### Types

| Name | Description |
|------|-------------|
| `ElicitationRequest` |  |
| `FormElicitationOptions` |  |
| `IntegrationLoaderConfig` | Configuration for loading integration tools into MCP |
| `MCPServerConfig` | `createMCPServer()` config |
| `MCPStats` | Registry statistics |
| `MCPTool` | Generic MCP tool definition |
| `Task` |  |
| `ToolAnnotations` | Behavioral hints for MCP clients (MCP 2025-11-25). |
| `ToolListEntry` | Wire format for a single tool in a tools/list response. |
| `UrlElicitationOptions` |  |

## Related

Reference modules:

- [`veryfront/tool`](./tool.md): Define tools for MCP
- [`veryfront/prompt`](./prompt.md): Define prompts for MCP
- [`veryfront/resource`](./resource.md): Define resources for MCP

User guides:

- [mcp-server](../../guides/mcp-server.md): Build and host MCP servers

Architecture:

- [07-mcp-runtime](../../architecture/07-mcp-runtime.md): MCP runtime architecture
