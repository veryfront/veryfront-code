---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 14
---

# veryfront/mcp

MCP server exposing tools, prompts, and resources.

This is the application-facing MCP surface. It is separate from the internal AG-UI transport used by Veryfront Studio and internal agent control-plane flows.

## Import

```ts
import {
  createMCPServer,
  registerTool,
  registerPrompt,
  registerResource,
  clearMCPRegistry,
  getMCPRegistry,
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

// Create the app-facing MCP server and mount its HTTP handler
const server = createMCPServer({ enabled: true });
const handler = server.createHTTPHandler();
```

## API

### `createMCPServer(config)`

Create MCP server

**Returns:** `MCPServer`

### `server.createHTTPHandler()`

Create the HTTP transport handler for the application-facing MCP server.

The handler expects MCP JSON-RPC over HTTP, manages `MCP-Session-Id` headers
after `initialize`, and handles `POST`, `DELETE`, and `OPTIONS` requests.

**Returns:** `(request: Request) => Promise<Response>`

### `MCPServerConfig`

Current config shape:

| Property | Type | Description |
|------|-------------|-------------|
| `enabled` | `boolean` | Enable the MCP server surface |
| `port?` | `number` | Optional port for hosted/runtime wiring |
| `auth?` | `{ type: "bearer" \| "api-key" \| "none"; validate?: Function }` | Optional request authentication |
| `cors?` | `{ enabled: boolean; origins?: string[] }` | Optional CORS configuration |

## Exports

### Functions

| Name | Description |
|------|-------------|
| `clearMCPRegistry` | Clear all registries |
| `createMCPServer` | Create MCP server |
| `getMCPRegistry` | Get tool/prompt/resource registry |
| `getMCPStats` | Get registered capability stats |
| `registerPrompt` | Register prompt with MCP |
| `registerResource` | Register resource with MCP |
| `registerTool` | Register tool with MCP |

### Classes

| Name | Description |
|------|-------------|
| `MCPServer` | MCP server instance |

### Types

| Name | Description |
|------|-------------|
| `IntegrationLoaderConfig` | Configuration for loading integration tools into MCP |
| `MCPServerConfig` | `createMCPServer()` config |
| `MCPStats` | Registry statistics |
| `MCPTool` | Generic MCP tool definition |

## Related

- [`veryfront/tool`](./tool.md) — Define tools for MCP
- [`veryfront/prompt`](./prompt.md) — Define prompts for MCP
- [`veryfront/resource`](./resource.md) — Define resources for MCP
