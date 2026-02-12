---
title: "veryfront/resource"
description: "Declare and register resources exposable over MCP."
order: 13
---

Declare and register resources exposable over MCP.

## Import

```ts
import { resource, resourceRegistry } from "veryfront/resource";
```

## Examples

```ts
import { resource } from "veryfront/resource";
import { z } from "zod";

const docs = resource({
  pattern: "docs/:section",
  description: "API documentation",
  paramsSchema: z.object({ section: z.string() }),
  load: async ({ section }) => {
    return { content: await readDocs(section) };
  },
});
```

## API

### `resource(config)`

Create MCP-discoverable resource

| Property | Type | Description |
|----------|------|-------------|
| `pattern?` | `string` | URI template pattern for parameterized resources |
| `description` | `string` | Resource description |
| `paramsSchema` | `z.ZodSchema<TParams>` | Zod schema for URI parameters |
| `load` | `(params: TParams) => Promise<TData> \\| TData` | Function returning resource content |
| `subscribe?` | `(params: TParams) => AsyncIterable<TData>` | Async iterable for real-time resource updates |
| `mcp?` | `McpConfig` | MCP server configuration |

**Returns:** `Resource<TParams, TData>`

## Exports

### Functions

| Name | Description |
|------|-------------|
| `resource` | Create MCP-discoverable resource |

### Types

| Name | Description |
|------|-------------|
| `Resource` | `resource()` return type |
| `ResourceConfig` | `resource()` config |

### Constants

| Name | Description |
|------|-------------|
| `resourceRegistry` | Global resource registry |

## Related

- [`veryfront/mcp`](./mcp.md) — Expose resources via MCP
