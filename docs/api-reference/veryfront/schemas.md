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
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L64) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `defineSchema` | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L36) |
| `lazySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L6) |
| `schemaIsOptional` | Returns `true` when the schema permits `undefined`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L28) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L18) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbsolutePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L83) |
| `DateRange` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L97) |
| `Email` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L91) |
| `FilePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L75) |
| `HexColor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L62) |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L8) |
| `JsonValue` | Recursive JSON value type - a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L38) |
| `NonEmptyString` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L14) |
| `NonNegativeInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L24) |
| `Pagination` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L96) |
| `PhoneNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L95) |
| `PortNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L29) |
| `PositiveInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L19) |
| `Semver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L70) |
| `Slug` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L93) |
| `StrongPassword` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L98) |
| `Timestamp` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L32) |
| `Url` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L94) |
| `Uuid` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L92) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAbsolutePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L77) |
| `getDateRangeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L38) |
| `getEmailSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L19) |
| `getFilePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L72) |
| `getHexColorSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L59) |
| `getJsonValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L46) |
| `getNonEmptyStringSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L11) |
| `getNonNegativeIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L21) |
| `getPaginationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L29) |
| `getPhoneNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L25) |
| `getPortNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L26) |
| `getPositiveIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L16) |
| `getSemverSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L64) |
| `getSlugSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L21) |
| `getStrongPasswordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L49) |
| `getTimestampSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L31) |
| `getUrlSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L22) |
| `getUuidSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L20) |
