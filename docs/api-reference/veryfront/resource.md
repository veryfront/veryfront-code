---
title: "veryfront/resource"
description: "Declare and register resources exposable over MCP."
order: 24
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
| `pattern?` | `string` | URI template pattern for parameterized resources | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L27) |
| `description` | `string` | Resource description | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L28) |
| `title?` | `string` | Optional human-readable title | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L29) |
| `paramsSchema` | <code>Schema&lt;TParams&gt;</code> | Schema for URI parameters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L30) |
| `load` | <code>(params: TParams, context?: Readonly&lt;ResourceLoadContext&gt;) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Function returning resource content | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L31) |
| `subscribe?` | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code> | Optional application-level update stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L41) |
| `mcp?` | `McpConfig` | MCP exposure metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L48) |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `resource` | Create a typed resource definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts#L16) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `McpConfig` | MCP resource exposure configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L55) |
| `McpContentConfig` | MCP resource content transport configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L53) |
| `Resource` | Public API contract for resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L52) |
| `ResourceConfig` | Configuration used by resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L26) |
| `ResourceLoadContext` | Per-read runtime context supplied to a resource loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L18) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resourceRegistry` | Project-scoped resource registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts#L212) |
