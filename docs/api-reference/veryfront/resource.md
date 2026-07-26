---
title: "veryfront/resource"
description: "Declare and register resources exposable over MCP."
order: 23
---

## Import

```ts
import { resource, resourceRegistry } from "veryfront/resource";
```

## Examples

```ts
import { resource } from "veryfront/resource";
import { defineSchema } from "veryfront/schemas";

const docsBySection: Record<string, string> = {
  agents: "Agents accept messages, tools, context, and runtime options.",
  tools: "Tools expose schema-backed callable capabilities.",
};

const docs = resource({
  pattern: "docs/:section",
  description: "API documentation",
  paramsSchema: defineSchema((v) => v.object({ section: v.string() }))(),
  load: ({ section }) => {
    return { content: docsBySection[section] ?? "Section not found." };
  },
});

const result = await docs.load({ section: "agents" });
```

## API

### `resource(config)`

Create a typed resource definition.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `pattern?` | `string` | URI template pattern for parameterized resources | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L19) |
| `description` | `string` | Resource description | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L20) |
| `title?` | `string` | Optional human-readable title | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L21) |
| `paramsSchema` | <code>Schema&lt;TParams&gt;</code> | Schema for URI parameters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L22) |
| `load` | <code>(params: TParams) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Function returning resource content | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L23) |
| `subscribe?` | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code> | Optional application-level update stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L30) |
| `mcp?` | `McpConfig` | MCP exposure metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L37) |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `resource` | Create a typed resource definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts#L16) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Resource` | Public API contract for resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L41) |
| `ResourceConfig` | Configuration used by resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L18) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resourceRegistry` | Project-scoped resource registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts#L169) |
