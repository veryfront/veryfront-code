---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper. Schema materialization requires a registered `SchemaValidator`. Veryfront runtime bootstrap registers the built-in validator before handlers run. `lazySchema` keeps module-scope schema constants import-safe before bootstrap."
order: 28
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
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L81) |

### Functions

| Name                 | Description                                                     | Source                                                                                         |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `defineSchema`       | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L37)      |
| `lazySchema`         |                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L25)        |
| `schemaIsOptional`   | Returns `true` when the schema permits `undefined`.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L33) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L23) |

### Types

| Name             | Description                                                                                                                                                                                             | Source                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `AbsolutePath`   |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L99)           |
| `DateRange`      |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L114)              |
| `Email`          |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L108)              |
| `FilePath`       |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L88)           |
| `HexColor`       |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L72)           |
| `JsonSchema`     | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L9) |
| `JsonValue`      | Recursive JSON value type - a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L48)           |
| `NonEmptyString` |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L20)           |
| `NonNegativeInt` |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L30)           |
| `Pagination`     |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L113)              |
| `PhoneNumber`    |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L112)              |
| `PortNumber`     |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L39)           |
| `PositiveInt`    |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L25)           |
| `Semver`         |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L80)           |
| `Slug`           |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L110)              |
| `StrongPassword` |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L115)              |
| `Timestamp`      |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L42)           |
| `Url`            |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L111)              |
| `Uuid`           |                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L109)              |

### Constants

| Name                      | Description | Source                                                                                        |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `getAbsolutePathSchema`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L90) |
| `getDateRangeSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L52)     |
| `getEmailSchema`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L26)     |
| `getFilePathSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L82) |
| `getHexColorSchema`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L69) |
| `getJsonValueSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L56) |
| `getNonEmptyStringSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L17) |
| `getNonNegativeIntSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L27) |
| `getPaginationSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L38)     |
| `getPhoneNumberSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L34)     |
| `getPortNumberSchema`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L32) |
| `getPositiveIntSchema`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L22) |
| `getSemverSchema`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L74) |
| `getSlugSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L28)     |
| `getStrongPasswordSchema` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L63)     |
| `getTimestampSchema`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L41) |
| `getUrlSchema`            |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L31)     |
| `getUuidSchema`           |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L27)     |
