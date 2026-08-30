---
title: "veryfront/resource"
description: "Declare and register schema-backed URI resources exposable over MCP. URI templates support hierarchical, rootless, embedded, and query parameters; opaque identifiers remain literal. Captures are percent-decoded exactly once, malformed escapes do not match, and `mcp.enabled: false` hides list and read."
order: 28
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

Create a typed resource definition with unique URI-template parameter names.

| Property       | Type                                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pattern?`     | `string`                                                               | URI template using `:name` parameters. Hierarchical (`/users/:id`) and rootless (`docs:collection/:id`) paths are supported, as are embedded and query parameters (`/file-:base.:ext?lang=:lang`). Opaque identifiers such as `urn:isbn` remain literal. Parameter names must be unique and separated by literal text; the first following literal delimits an embedded value. A `:` directly following an alphanumeric character is always data, never a parameter: write `/files/file-:id`, not `/files/file:id`. This keeps opaque colon identifiers literal under one uniform rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `description`  | `string`                                                               | Resource description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `title?`       | `string`                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `paramsSchema` | <code>Schema&lt;TParams&gt;</code>                                     | Schema that validates and transforms URI parameters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `load`         | <code>(params: TParams) =&gt; Promise&lt;TData&gt; &#124; TData</code> | Function returning resource content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `subscribe?`   | <code>(params: TParams) =&gt; AsyncIterable&lt;TData&gt;</code>        | Async iterable for real-time resource updates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `mcp?`         | `McpConfig`                                                            | MCP configuration. `enabled: false` hides the resource from lists and reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |

**Returns:** <code>Resource&lt;TParams, TData&gt;</code>

## Exports

### Functions

| Name       | Description                                                                  | Source                                                                                  |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `resource` | Create a typed resource definition with unique URI-template parameter names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/factory.ts) |

### Types

| Name             | Description                                                                                                                                        | Source                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Resource`       | Public API contract for resource.                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |
| `ResourceConfig` | Configuration used by resource. URI captures are decoded exactly once before schema validation; malformed percent escapes do not match a resource. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/types.ts) |

### Constants

| Name               | Description                     | Source                                                                                   |
| ------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `resourceRegistry` | Shared resource registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/resource/registry.ts) |
