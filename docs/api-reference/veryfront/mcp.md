---
title: "veryfront/mcp"
description: "MCP server exposing tools, prompts, and resources. Resource-template captures are percent-decoded exactly once; malformed escapes are not found, and resources with `mcp.enabled: false` are omitted from both lists and reads."
order: 18
---

## Import

```ts
import {
  buildFormElicitation,
  buildUrlElicitation,
  createMCPServer,
  registerPrompt,
  registerResource,
  registerTool,
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

| Name                    | Description                                                                                                                                        | Source                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `buildFormElicitation`  | Builds form elicitation.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts) |
| `buildUrlElicitation`   | Builds URL elicitation.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts) |
| `clearMCPRegistry`      | Clear MCP registry.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |
| `createMCPServer`       | Create mcpserver.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts)      |
| `formatSSEEvent`        | Stateless SSE formatting utilities per the Server-Sent Events standard. Used by the Streamable HTTP transport for MCP.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts)         |
| `formatSSEPrimingEvent` | Format an SSE priming event.                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts)         |
| `formatSSERetry`        | Formats sseretry.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/sse.ts)         |
| `getMCPRegistry`        | Return MCP registry.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |
| `getMCPStats`           | Return MCP stats.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |
| `registerPrompt`        | Registers prompt.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |
| `registerResource`      | Registers a schema-backed resource. MCP reads decode URI captures exactly once before validation; `mcp.enabled: false` hides list and read access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |
| `registerTool`          | Registers tool.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/registry.ts)    |

### Classes

| Name             | Description           | Source                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `MCPServer`      | Implement mcpserver.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/server.ts)     |
| `SessionManager` |                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/session.ts)    |
| `TaskStore`      | Implement task store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts) |

### Types

| Name                     | Description                                                                                                 | Source                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ElicitationRequest`     | Request payload for elicitation.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts)        |
| `FormElicitationOptions` | Options accepted by form elicitation.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts)        |
| `MCPServerConfig`        | Configuration used by mcpserver.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts) |
| `MCPStats`               | Public API contract for MCP stats.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/schemas/mcp.schema.ts) |
| `MCPTool`                | Generic MCP tool definition                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts)              |
| `Task`                   | Public API contract for task.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/task-store.ts)         |
| `ToolAnnotations`        | Behavioral hints for MCP clients (MCP 2025-11-25). Guides auto-approval, confirmation prompts, and caching. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/annotations.ts)        |
| `ToolListEntry`          | Wire format for a single tool in a tools/list response.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/types.ts)              |
| `UrlElicitationOptions`  | Options accepted by URL elicitation.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/mcp/elicitation.ts)        |
