---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper. Schema materialization requires a registered `SchemaValidator`. Veryfront runtime bootstrap registers the built-in validator before handlers run. `lazySchema` keeps module-scope schema constants import-safe before bootstrap."
order: 34
---

## Import

```ts
import {
  CommonSchemas,
  defineSchema,
  getAbsolutePathSchema,
  lazySchema,
  schemaIsOptional,
  schemaToJsonSchema,
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

| Name            | Description                                                                                                                                                                                                               | Source                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts) |

### Functions

| Name                 | Description                                                     | Source                                                                                     |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `defineSchema`       | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts)      |
| `lazySchema`         |                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts)        |
| `schemaIsOptional`   | Returns `true` when the schema permits `undefined`.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts) |

### Types

| Name             | Description                                                                                                                      | Source                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `AbsolutePath`   |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `DateRange`      |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `Email`          |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `FilePath`       |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `HexColor`       |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `JsonSchema`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts) |
| `JsonValue`      | Recursive JSON value type: a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `NonEmptyString` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `NonNegativeInt` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `Pagination`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `PhoneNumber`    |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `PortNumber`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `PositiveInt`    |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `Semver`         |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `Slug`           |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `StrongPassword` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `Timestamp`      |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts)            |
| `Url`            |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |
| `Uuid`           |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)                |

### Constants

| Name                      | Description | Source                                                                                    |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `getAbsolutePathSchema`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getDateRangeSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getEmailSchema`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getFilePathSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getHexColorSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getJsonValueSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getNonEmptyStringSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getNonNegativeIntSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getPaginationSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getPhoneNumberSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getPortNumberSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getPositiveIntSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getSemverSchema`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getSlugSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getStrongPasswordSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getTimestampSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts) |
| `getUrlSchema`            |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
| `getUuidSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts)     |
