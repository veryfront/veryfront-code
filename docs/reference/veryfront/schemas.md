---
title: "veryfront/schemas"
description: "Reusable validation schemas, lazy schema factories, and JSON Schema helpers."
order: 12
---

Reusable validation schemas, lazy schema factories, and JSON Schema helpers.

## Import

```ts
import {
  CommonSchemas,
  defineSchema,
  getEmailSchema,
  getJsonValueSchema,
  schemaToJsonSchema,
} from "veryfront/schemas";
```

## Examples

### Use a common schema

```ts
import { CommonSchemas } from "veryfront/schemas";

const email = CommonSchemas.email.parse("user@example.com");
```

### Define a lazy schema

```ts
import { defineSchema } from "veryfront/schemas";

const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1),
  })
);

const user = getUserSchema().parse(input);
```

## API

### `defineSchema(factory)`

Create a lazy schema getter that resolves the registered `SchemaValidator` on first use.

| Parameter | Type | Description | Source |
| --------- | ---- | ----------- | ------ |
| `factory` | `SchemaFactory<T>` | Function that receives a `SchemaValidator` and returns a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L37) |

**Returns:** <code>() =&gt; Schema&lt;T&gt;</code>

### `lazySchema(getSchema)`

Create a schema facade that materializes the wrapped schema on first use.

| Parameter | Type | Description | Source |
| --------- | ---- | ----------- | ------ |
| `getSchema` | <code>() =&gt; Schema&lt;T&gt;</code> | Function that returns the schema to cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L7) |

**Returns:** <code>Schema&lt;T&gt;</code>

### `schemaToJsonSchema(schema)`

Convert a contract-backed schema to a JSON Schema document.

| Parameter | Type | Description | Source |
| --------- | ---- | ----------- | ------ |
| `schema` | `Schema<unknown>` | Schema to convert through the registered `SchemaValidator`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L19) |

**Returns:** `JsonSchema`

### `schemaIsOptional(schema)`

Return whether a schema permits `undefined`.

| Parameter | Type | Description | Source |
| --------- | ---- | ----------- | ------ |
| `schema` | `Schema<unknown>` | Schema to inspect through the registered `SchemaValidator`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L29) |

**Returns:** `boolean`

## Exports

### Components

| Name | Description | Source |
| ---- | ----------- | ------ |
| `CommonSchemas` | Lazy getters for common schema instances. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L65) |

### Functions

| Name | Description | Source |
| ---- | ----------- | ------ |
| `defineSchema` | Create a lazy schema getter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L37) |
| `getAbsolutePathSchema` | Get a schema for absolute filesystem paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L78) |
| `getDateRangeSchema` | Get a schema for ordered timestamp ranges. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L39) |
| `getEmailSchema` | Get an email schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L20) |
| `getFilePathSchema` | Get a non-empty file path schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L73) |
| `getHexColorSchema` | Get a hex color schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L60) |
| `getJsonValueSchema` | Get a recursive JSON value schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L47) |
| `getNonEmptyStringSchema` | Get a non-empty string schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L12) |
| `getNonNegativeIntSchema` | Get a non-negative integer schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L22) |
| `getPaginationSchema` | Get a pagination schema with defaults. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L30) |
| `getPhoneNumberSchema` | Get an E.164-style phone number schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L26) |
| `getPortNumberSchema` | Get a TCP port number schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L27) |
| `getPositiveIntSchema` | Get a positive integer schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L17) |
| `getSemverSchema` | Get a semantic version schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L65) |
| `getSlugSchema` | Get a slug schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L22) |
| `getStrongPasswordSchema` | Get a strong password schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L50) |
| `getTimestampSchema` | Get an ISO date-time schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L32) |
| `getUrlSchema` | Get a URL schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L23) |
| `getUuidSchema` | Get a UUID schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L21) |
| `lazySchema` | Create a lazy schema facade. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L7) |
| `schemaIsOptional` | Return whether a schema permits `undefined`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L29) |
| `schemaToJsonSchema` | Convert a schema to JSON Schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L19) |

### Types

| Name | Description | Source |
| ---- | ----------- | ------ |
| `AbsolutePath` | Absolute path string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L84) |
| `DateRange` | Timestamp range with `from` and `to`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L98) |
| `Email` | Email string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L92) |
| `FilePath` | Non-empty file path string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L76) |
| `HexColor` | Hex color string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L63) |
| `JsonSchema` | JSON Schema document type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L33) |
| `JsonValue` | Recursive JSON value type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L39) |
| `NonEmptyString` | Non-empty string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L15) |
| `NonNegativeInt` | Non-negative integer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L25) |
| `Pagination` | Pagination input with page, limit, sort, and order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L97) |
| `PhoneNumber` | E.164-style phone number string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L96) |
| `PortNumber` | TCP port number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L30) |
| `PositiveInt` | Positive integer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L20) |
| `Semver` | Semantic version string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L71) |
| `Slug` | Lowercase slug string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L94) |
| `StrongPassword` | Strong password string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L99) |
| `Timestamp` | ISO date-time string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L33) |
| `Url` | URL string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L95) |
| `Uuid` | UUID string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L93) |

## Related guides

- [Tools](../../guides/tools.md): use schemas for typed tool inputs
- [Configuration](../../guides/configuration.md): configure runtime behavior
