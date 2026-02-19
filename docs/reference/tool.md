---
title: "veryfront/tool"
description: "Define tools with Zod schemas for agents and MCP."
order: 10
---

# veryfront/tool

Define tools with Zod schemas for agents and MCP.

## Import

```ts
import {
  tool,
  dynamicTool,
  toolRegistry,
  executeTool,
} from "veryfront/tool";
```

## Examples

### Basic tool

```ts
import { tool } from "veryfront/tool";
import { z } from "zod";

const weather = tool({
  id: "weather",
  description: "Get current weather for a city",
  inputSchema: z.object({ city: z.string() }),
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
import { z } from "zod";

const weather = tool({
  id: "weather",
  description: "Get current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return res.json();
  },
});

const assistant = agent({
  model: "openai/gpt-4o",
  system: "You help with weather questions.",
  tools: [weather],
});
```

## API

### `tool(config)`

Create typed tool (Zod-validated)

| Property | Type | Description |
|----------|------|-------------|
| `id?` | `string` | Tool identifier (optional, inferred from filename) |
| `description` | `string` | Tool description for the AI model |
| `inputSchema` | <code>z.ZodSchema&lt;TInput&gt;</code> | Input schema (Zod schema) |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-Zod schemas to fall back to a permissive JSON schema. |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; \\| TOutput</code> | Tool execution function |
| `mcp?` | <code>&#123; enabled?: boolean; requiresAuth?: boolean; cachePolicy?: "no-cache" \\| "cache" \\| "cache-first" &#125;</code> | MCP configuration |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Functions

| Name | Description |
|------|-------------|
| `dynamicTool` | Create tool with runtime schema |
| `executeTool` | Execute tool by ID |
| `tool` | Create typed tool (Zod-validated) |

### Types

| Name | Description |
|------|-------------|
| `DynamicToolConfig` | `dynamicTool()` config |
| `JsonSchema` | JSON Schema for tool input |
| `Tool` | Tool instance (returned by tool() function) |
| `ToolConfig` | Tool configuration options |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. |
| `ToolExecutionContext` | Context passed to tool execution |

### Constants

| Name | Description |
|------|-------------|
| `toolRegistry` | Global tool registry |

## Related

- [`veryfront/agent`](./agent.md) — Agents that use tools
- [`veryfront/mcp`](./mcp.md) — Expose tools via MCP
