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
| `id?` | `string` | Explicit registry identity. Defaults to an identity derived from pattern. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L30) |
| `pattern?` | `string` | Resource URI pattern. Discovery may supply this from the source path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L32) |
| `description` | `string` | Human-readable description exposed to resource clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L34) |
| `title?` | `string` | Optional human-readable display title. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L36) |
| `paramsSchema` | <code>ResourceParamsSchema&lt;TParams&gt;</code> | Schema that validates and may transform resource parameters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L38) |
| `load` | <code>(params: TParams, context: ResourceLoadContext) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Load the current resource value with an immutable lifecycle context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L40) |
| `subscribe?` | <code>(params: TParams, context: ResourceLoadContext) =&gt; AsyncIterable&lt;TData&gt;</code> | Optionally stream resource updates with an immutable lifecycle context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L45) |
| `mcp?` | `McpConfig` | MCP exposure and cache configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L50) |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `resource` | Create a typed resource definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts#L207) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CachePolicy` | Cache behavior exposed through the MCP resource contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L19) |
| `McpConfig` | MCP exposure options for a resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/schemas/resource.schema.ts#L21) |
| `Resource` | Public API contract for a validated resource definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L54) |
| `ResourceConfig` | Configuration used to create a resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L28) |
| `ResourceLoadContext` | Cancellation and lifecycle values available while reading a resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L16) |
| `ResourceParamsSchema` | Minimal validation contract required by resource definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts#L22) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `resourceRegistry` | Shared resource registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts#L150) |
