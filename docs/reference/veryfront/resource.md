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

const docsBySection: Record<string, string> = {
  agents: "Agents accept messages, tools, context, and runtime options.",
  tools: "Tools expose schema-backed callable capabilities.",
};

const docs = resource({
  pattern: "docs/:section",
  description: "API documentation",
  paramsSchema: z.object({ section: z.string() }),
  load: ({ section }) => {
    return { content: docsBySection[section] ?? "Section not found." };
  },
});

const result = await docs.load({ section: "agents" });
```

## API

### `resource(config)`

Create MCP-discoverable resource

| Property | Type | Description |
|----------|------|-------------|
| `pattern?` | `string` | URI template pattern for parameterized resources |
| `description` | `string` | Resource description |
| `title?` | `string` |  |
| `paramsSchema` | <code>Schema&lt;TParams&gt;</code> | Zod schema for URI parameters |
| `load` | <code>(params: TParams) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Function returning resource content |
| `subscribe?` | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code> | Async iterable for real-time resource updates |
| `mcp?` | `McpConfig` | MCP server configuration |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `resource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts#L11) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Resource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L26) |
| `ResourceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L16) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resourceRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts#L40) |

## Related

Reference modules:

- [`veryfront/mcp`](./mcp.md): Expose resources via MCP

User guides:

- [mcp-server](../../guides/mcp-server.md): Expose resources over MCP

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): Resources as AI primitives
