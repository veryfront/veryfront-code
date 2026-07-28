---
title: "veryfront/resource"
description: "Declare and register resources exposable over MCP."
order: 25
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
| `pattern?` | `string` | URI pattern. Patterns may contain at most 8,192 characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L28) |
| `description` | `string` | Model-facing description. Limited to 16,384 characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L30) |
| `title?` | `string` | Optional display title. Limited to 1,024 characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L32) |
| `paramsSchema` | <code>Schema&lt;TParams&gt;</code> | Parameter schema captured when the resource is constructed or registered. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L34) |
| `load` | <code>(params: TParams, context?: Readonly&lt;ResourceLoadContext&gt;) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Loader captured when the resource is constructed or registered. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L36) |
| `subscribe?` | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code> | Optional application-level update stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L46) |
| `mcp?` | `McpConfig` | MCP exposure metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L52) |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `resource` | Create a typed resource definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts#L16) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `McpConfig` | MCP resource exposure configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L48) |
| `McpContentConfig` | MCP resource content transport configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L46) |
| `Resource` | Normalized runtime resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L71) |
| `ResourceConfig` | Configuration used by resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L26) |
| `ResourceDefinition` | Authored resource definition accepted at a registry boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L56) |
| `ResourceLoadContext` | Per-read runtime context supplied to a resource loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L18) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resourceRegistry` | Project-scoped resource registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts#L218) |
