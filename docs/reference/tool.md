---
title: "veryfront/tool"
description: "Define tools with schema-backed inputs for agents and MCP."
order: 10
---

# veryfront/tool

Define tools with schema-backed inputs for agents and MCP.

## Import

```ts
import {
  createRemoteMCPToolSource,
  dynamicTool,
  executeTool,
  tool,
  toolRegistry,
} from "veryfront/tool";
```

## Examples

### Basic tool

```ts
import { tool } from "veryfront/tool";
import { defineSchema, lazySchema } from "veryfront/schemas";

const getWeatherInput = defineSchema((v) => v.object({ city: v.string() }));

const weather = tool({
  id: "weather",
  description: "Get current weather for a city",
  inputSchema: lazySchema(getWeatherInput),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return res.json();
  },
});
```

### Use with an agent

```ts
import { tool } from "veryfront/tool";
import { agent } from "veryfront/agent";
import { defineSchema, lazySchema } from "veryfront/schemas";

const getWeatherInput = defineSchema((v) => v.object({ city: v.string() }));

const weather = tool({
  id: "weather",
  description: "Get current weather for a city",
  inputSchema: lazySchema(getWeatherInput),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return res.json();
  },
});

const assistant = agent({
  system: "You help with weather questions.",
  tools: [weather],
});
```

### Remote MCP tool source

```ts
import { createRemoteMCPToolSource, loadRemoteToolsFromSource } from "veryfront/tool";

const docsTools = createRemoteMCPToolSource({
  id: "docs-mcp",
  endpoint: "https://docs.example.com/mcp",
  headers: { Authorization: `Bearer ${Deno.env.get("DOCS_TOKEN")}` },
});

const runtimeTools = await loadRemoteToolsFromSource(docsTools, {
  context: { projectId: "proj_123" },
  toolNameAliases: { search_docs: "docs_search" },
});
```

## API

### `tool(config)`

Create typed tool (Zod-validated)

| Property              | Type                                                                                                                               | Description                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `id?`                 | `string`                                                                                                                           | Tool identifier (optional, inferred from filename)                      |
| `description`         | `string`                                                                                                                           | Tool description for the AI model                                       |
| `inputSchema`         | <code>z.ZodSchema&lt;TInput&gt;</code>                                                                                             | Input schema (Zod schema)                                               |
| `allowUnknownSchema?` | `boolean`                                                                                                                          | Allow unknown/non-Zod schemas to fall back to a permissive JSON schema. |
| `execute`             | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code>                           | Tool execution function                                                 |
| `mcp?`                | <code>&#123; enabled?: boolean; requiresAuth?: boolean; cachePolicy?: "no-cache" &#124; "cache" &#124; "cache-first" &#125;</code> | MCP configuration                                                       |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

### `createRemoteMCPToolSource(config)`

Create a per-request remote tool source backed by an MCP `tools/list` + `tools/call` endpoint.

| Property      | Type                                                                                                                   | Description                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `id?`         | `string`                                                                                                               | Stable source identifier for logs/debugging              |
| `endpoint`    | <code>string &#124; ((context?: ToolExecutionContext) =&gt; string &#124; Promise&lt;string&gt;)</code>                | Remote MCP endpoint                                      |
| `headers?`    | <code>HeadersInit &#124; ((context?: ToolExecutionContext) =&gt; HeadersInit &#124; Promise&lt;HeadersInit&gt;)</code> | Optional dynamic headers                                 |
| `fetch?`      | `typeof fetch`                                                                                                         | Override fetch implementation for custom runtimes/tests  |
| `listMethod?` | `string`                                                                                                               | JSON-RPC method for discovery (defaults to `tools/list`) |
| `callMethod?` | `string`                                                                                                               | JSON-RPC method for execution (defaults to `tools/call`) |

**Returns:** `RemoteToolSource`

### `createToolsFromRemoteDefinitions(source, definitions, options?)`

Materialize runtime `Tool` instances from remote definitions while preserving the remote JSON schema.

### `loadRemoteToolsFromSource(source, options?)`

List tools from a remote source and materialize them into runtime `Tool` instances.

## Exports

### Functions

| Name                               | Description                                       |
| ---------------------------------- | ------------------------------------------------- |
| `createToolsFromRemoteDefinitions` | Materialize runtime tools from remote definitions |
| `dynamicTool`                      | Create tool with runtime schema                   |
| `createRemoteMCPToolSource`        | Create a remote MCP-backed tool source            |
| `executeTool`                      | Execute tool by ID                                |
| `loadRemoteToolsFromSource`        | Load and materialize tools from a remote source   |
| `tool`                             | Create typed tool (Zod-validated)                 |

### Types

| Name                               | Description                                                       |
| ---------------------------------- | ----------------------------------------------------------------- |
| `DynamicToolConfig`                | `dynamicTool()` config                                            |
| `JsonSchema`                       | JSON Schema for tool input                                        |
| `RemoteMCPToolSourceConfig`        | `createRemoteMCPToolSource()` config                              |
| `RemoteToolMaterializationOptions` | Options for loading/materializing remote tools                    |
| `RemoteToolSource`                 | Runtime-discovered remote tool source                             |
| `Tool`                             | Tool instance (returned by tool() function)                       |
| `ToolConfig`                       | Tool configuration options                                        |
| `ToolDefinition`                   | Provider-facing tool definition used for model/tool registration. |
| `ToolExecutionContext`             | Context passed to tool execution                                  |

### Constants

| Name           | Description          |
| -------------- | -------------------- |
| `toolRegistry` | Global tool registry |

## Related

- [`veryfront/agent`](./agent.md) — Agents that use tools
- [`veryfront/mcp`](./mcp.md) — Expose tools via MCP
