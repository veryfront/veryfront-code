# @veryfront/ext-schema-zod

> **Category:** Schema | **Contract:** `SchemaValidator` | **Built-in**

Provides schema validation for Veryfront, backed by [Zod](https://zod.dev/). Once loaded, any module that calls `defineSchema((v) => v.object({...}))` resolves through this extension's Zod-powered adapter.

## How It Works

Core modules never import zod directly. Instead they declare schemas via `defineSchema`:

```ts
import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";

const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1),
    email: v.string().email().optional(),
  })
);

type User = InferSchema<ReturnType<typeof getUserSchema>>;

const user = getUserSchema().parse(input);
```

The `v` parameter is a `SchemaValidator` instance provided by this extension. It exposes a zod-inspired DSL covering primitives, composites, chainables, and validation methods.

## Registration

ext-schema-zod is registered automatically by `createBuiltinExtensions()` at app bootstrap. It is placed **first** in the builtin chain so that other extensions can use `defineSchema` in their own `setup()` hooks.

### Test Setup

Tests that use `defineSchema` without full app bootstrap need to register the adapter explicitly:

```ts
import "#veryfront/schemas/_test-setup.ts";
```

Or manually:

```ts
import { register } from "veryfront/extensions/contracts";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

register("SchemaValidator", createZodAdapter());
```

## Supported DSL

### Primitives

`string()`, `number()`, `boolean()`, `date()`, `null()`, `unknown()`, `any()`, `bigint()`

### Composites

`object(shape)`, `array(schema)`, `record(keys, values)`, `union(schemas)`, `discriminatedUnion(key, schemas)`, `literal(value)`, `enum(values)`, `tuple(items)`, `lazy(factory)`, `instanceof(ctor)`

### Chainables

`.optional()`, `.nullable()`, `.nullish()`, `.default(value)`, `.describe(text)`, `.refine(fn)`, `.superRefine(fn)`, `.transform(fn)`, `.strict()`, `.passthrough()`, `.strip()`, `.partial()`, `.extend(shape)`, `.merge(schema)`, `.omit(keys)`, `.pick(keys)`

### String/Number Refinements

`.min(n)`, `.max(n)`, `.int()`, `.positive()`, `.nonnegative()`, `.regex(pattern)`, `.email()`, `.url()`, `.uuid()`, `.datetime()`

### Coercion

`v.coerce.string()`, `v.coerce.number()`, `v.coerce.boolean()`, `v.coerce.date()`

### Validation

`.parse(data)` throws on failure; `.safeParse(data)` returns `{ success, data }` or `{ success, issues }`.

### JSON Schema

`toJsonSchema(schema)` converts any `Schema<T>` to a JSON Schema object for OpenAPI or tool-call definitions.

`compileJsonSchema(schema)` compiles raw JSON Schema with strict validation,
standard formats, and no coercion, default insertion, or removal of additional
properties.

| Boundary                          | Limit                                         |
| --------------------------------- | --------------------------------------------- |
| Schema depth                      | 64 levels                                     |
| Schema nodes                      | 8,192                                         |
| Serialized schema                 | 512 KiB                                       |
| Schema string                     | 256 KiB                                       |
| Schema property name              | 4 KiB UTF-8                                   |
| Code-generating collection fanout | 256 entries                                   |
| Nested compilation work           | 24,000 units                                  |
| Validation input                  | 128 levels, 100,000 nodes, 4 MiB serialized   |
| Compiled-validator cache          | 128 entries and 2 MiB aggregate source weight |

Schemas and inputs must be data-only JSON. Accessors, symbol or hidden keys,
custom object prototypes, cycles, sparse arrays, and revoked proxies are
rejected without invoking property getters, setters, iterators, or `toJSON`.
Inspecting a Proxy necessarily invokes its reflection traps; a trap may run or
throw before the value is rejected. Successful validation returns the
adapter-owned input snapshot. Cache eviction is least-recently used when either
cache limit is exceeded.

## Running Tests

```sh
deno task test
```
