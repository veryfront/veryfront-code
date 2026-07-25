---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper. Schema materialization requires a registered `SchemaValidator`. Veryfront runtime bootstrap registers the built-in validator before handlers run. `lazySchema` keeps module-scope schema constants import-safe before bootstrap."
order: 28
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
import { CommonSchemas, defineSchema, lazySchema } from "veryfront/schemas";

const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1),
  })
);
export const UserSchema = lazySchema(getUserSchema);

export function parseEmail(input: unknown) {
  return CommonSchemas.email.parse(input);
}
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L91) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `defineSchema` | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L82) |
| `lazySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L39) |
| `schemaIsOptional` | Returns `true` when the schema permits `undefined`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L53) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L35) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbsolutePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L105) |
| `DateRange` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L124) |
| `Email` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L118) |
| `FilePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L93) |
| `HexColor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L76) |
| `JsonSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L18) |
| `JsonValue` | Recursive JSON value type: a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L50) |
| `NonEmptyString` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L22) |
| `NonNegativeInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L32) |
| `Pagination` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L123) |
| `PhoneNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L122) |
| `PortNumber` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L41) |
| `PositiveInt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L27) |
| `Semver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L84) |
| `Slug` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L120) |
| `StrongPassword` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L125) |
| `Timestamp` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L44) |
| `Url` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L121) |
| `Uuid` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L119) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAbsolutePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L95) |
| `getDateRangeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L62) |
| `getEmailSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L28) |
| `getFilePathSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L86) |
| `getHexColorSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L73) |
| `getJsonValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L52) |
| `getNonEmptyStringSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L19) |
| `getNonNegativeIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L29) |
| `getPaginationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L40) |
| `getPhoneNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L36) |
| `getPortNumberSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L34) |
| `getPositiveIntSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L24) |
| `getSemverSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L78) |
| `getSlugSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L30) |
| `getStrongPasswordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L73) |
| `getTimestampSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L43) |
| `getUrlSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L33) |
| `getUuidSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L29) |
