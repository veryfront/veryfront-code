---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper. Schema materialization requires a registered `SchemaValidator`. Veryfront runtime bootstrap registers the built-in validator before handlers run. `lazySchema` keeps module-scope schema constants import-safe before bootstrap."
order: 33
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

| Name            | Description                                                                                                                                                                                                               | Source                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L90) |

### Functions

| Name                 | Description                                                     | Source                                                                                         |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `defineSchema`       | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L81)      |
| `lazySchema`         |                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L38)        |
| `schemaIsOptional`   | Returns `true` when the schema permits `undefined`.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L52) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L34) |

### Types

| Name             | Description                                                                                                                      | Source                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AbsolutePath`   |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L115)           |
| `DateRange`      |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L123)               |
| `Email`          |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L117)               |
| `FilePath`       |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L103)           |
| `HexColor`       |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L86)            |
| `JsonSchema`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L17) |
| `JsonValue`      | Recursive JSON value type: a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L49)            |
| `NonEmptyString` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L21)            |
| `NonNegativeInt` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L31)            |
| `Pagination`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L122)               |
| `PhoneNumber`    |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L121)               |
| `PortNumber`     |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L40)            |
| `PositiveInt`    |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L26)            |
| `Semver`         |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L94)            |
| `Slug`           |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L119)               |
| `StrongPassword` |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L124)               |
| `Timestamp`      |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L43)            |
| `Url`            |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L120)               |
| `Uuid`           |                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L118)               |

### Constants

| Name                      | Description | Source                                                                                         |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `getAbsolutePathSchema`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L105) |
| `getDateRangeSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L61)      |
| `getEmailSchema`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L27)      |
| `getFilePathSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L96)  |
| `getHexColorSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L83)  |
| `getJsonValueSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L51)  |
| `getNonEmptyStringSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L18)  |
| `getNonNegativeIntSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L28)  |
| `getPaginationSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L39)      |
| `getPhoneNumberSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L35)      |
| `getPortNumberSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L33)  |
| `getPositiveIntSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L23)  |
| `getSemverSchema`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L88)  |
| `getSlugSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L29)      |
| `getStrongPasswordSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L72)      |
| `getTimestampSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L42)  |
| `getUrlSchema`            |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L32)      |
| `getUuidSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L28)      |
