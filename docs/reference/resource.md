---
title: "veryfront/resource"
description: "Declare and register resources exposable over MCP."
order: 13
---

# veryfront/resource

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
| `paramsSchema` | <code>z.ZodSchema&lt;TParams&gt;</code> | Zod schema for URI parameters |
| `load` | <code>(params: TParams) =&gt; Promise&lt;TData&gt; \\| TData</code> | Function returning resource content |
| `subscribe?` | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code> | Async iterable for real-time resource updates |
| `mcp?` | `McpConfig` | MCP server configuration |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

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
