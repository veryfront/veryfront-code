---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper."
order: 24
---

## Import

```ts
import {
  defineSchema,
  lazySchema,
  schemaIsOptional,
  schemaToJsonSchema,
  CommonSchemas,
  getAbsolutePathSchema,
} from "veryfront/schemas";
```

## Examples

```ts
import { CommonSchemas, defineSchema } from "veryfront/schemas";

const email = CommonSchemas.email.parse("user@example.com");

const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1),
  })
);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L65) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `defineSchema` | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L37) |
| `lazySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L7) |
| `schemaIsOptional` | Returns `true` when the schema permits `undefined`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L29) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L19) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbsolutePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L84) |
| `DateRange` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L98) |
| `Email` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L92) |
| `FilePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L76) |
| `HexColor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L63) |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L9) |
| `JsonValue` | Recursive JSON value type - a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L39) |
| `NonEmptyString` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L15) |
| `NonNegativeInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L25) |
| `Pagination` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L97) |
| `PhoneNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L96) |
| `PortNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L30) |
| `PositiveInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L20) |
| `Semver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L71) |
| `Slug` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L94) |
| `StrongPassword` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L99) |
| `Timestamp` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L33) |
| `Url` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L95) |
| `Uuid` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L93) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAbsolutePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L78) |
| `getDateRangeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L39) |
| `getEmailSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L20) |
| `getFilePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L73) |
| `getHexColorSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L60) |
| `getJsonValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L47) |
| `getNonEmptyStringSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L12) |
| `getNonNegativeIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L22) |
| `getPaginationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L30) |
| `getPhoneNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L26) |
| `getPortNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L27) |
| `getPositiveIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L17) |
| `getSemverSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L65) |
| `getSlugSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L22) |
| `getStrongPasswordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L50) |
| `getTimestampSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L32) |
| `getUrlSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L23) |
| `getUuidSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L21) |
