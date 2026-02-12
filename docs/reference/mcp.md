---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources."
order: 14
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

// Start MCP server — registered tools are exposed automatically
const server = createMCPServer();
```

## API

### `createMCPServer(config)`

Create MCP server

**Returns:** `MCPServer`

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
