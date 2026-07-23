---
title: "veryfront/schemas"
description: "Reusable validation schemas and the `defineSchema` helper."
order: 29
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
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L148) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `defineSchema` | Wrap a schema factory so that it is built lazily on first call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/define.ts#L39) |
| `lazySchema` | Create a schema facade that resolves and memoizes its backing schema on first use while preserving the backing implementation's method receiver. Failed resolutions are not cached. Recursive lazy aliases throw a deterministic `TypeError` instead of overflowing the call stack. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/lazy.ts#L16) |
| `schemaIsOptional` | Returns `true` when the schema permits `undefined`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L31) |
| `schemaToJsonSchema` | Convert an opaque `Schema<T>` to a JSON Schema document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/json-schema.ts#L20) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbsolutePath` | Validated absolute filesystem-path representation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L199) |
| `CommonSchemaRegistry` | Named shared schemas available through `CommonSchemas`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L124) |
| `DateRange` | Validated inclusive date range. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L119) |
| `Email` | Validated email address. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L107) |
| `FilePath` | Validated filesystem-path representation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L186) |
| `HexColor` | Validated hexadecimal color string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L166) |
| `InferInput` | Extracts the inferred *input* type from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L130) |
| `InferSchema` | Extracts the inferred output type `T` from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L119) |
| `InferShape` | Maps a raw object shape to its inferred object type, preserving optionality. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |
| `JsonSchema` | JSON Schema object with typed common keywords and support for draft-specific or vendor-defined keywords. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L24) |
| `JsonSchemaTypeName` | Primitive type names accepted by JSON Schema's `type` keyword. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L11) |
| `JsonValue` | Recursive JSON value type: a string, number, boolean, null, array of JsonValue, or object with string keys and JsonValue values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L70) |
| `NonEmptyString` | Validated non-empty string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L27) |
| `NonNegativeInt` | Validated non-negative safe integer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L47) |
| `Pagination` | Parsed pagination query. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L117) |
| `PhoneNumber` | Validated E.164-compatible phone number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L115) |
| `PortNumber` | Validated port number from 1 through 65,535. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L57) |
| `PositiveInt` | Validated positive safe integer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L37) |
| `RefinementCtx` | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L111) |
| `Schema` | An opaque schema definition that validates and infers type `T`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22) |
| `SchemaFactory` | Factory type accepted by `defineSchema`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L297) |
| `SchemaValidator` | SchemaValidator contract interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L194) |
| `SchemaValidatorCoerce` | Namespace for `coerce.*` constructors. It accepts input in any form and coerces to the target type before validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L176) |
| `Semver` | Validated semantic-version string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L176) |
| `Slug` | Validated lowercase slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L111) |
| `StrongPassword` | Validated password string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L121) |
| `Timestamp` | Validated ISO date-time string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L64) |
| `Url` | Validated absolute URL string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L113) |
| `Uuid` | Validated UUID string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L109) |
| `ValidationFailure` | Failed validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L160) |
| `ValidationIssue` | A single validation issue with location context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L142) |
| `ValidationResult` | Discriminated union of validation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L170) |
| `ValidationSuccess` | Successful validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L152) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAbsolutePathSchema` | Return a schema for bounded absolute POSIX, drive-letter, and UNC paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L189) |
| `getDateRangeSchema` | Return the shared inclusive date-range schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L83) |
| `getEmailSchema` | Return the shared email schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L32) |
| `getFilePathSchema` | Return a bounded filesystem-path representation schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L179) |
| `getHexColorSchema` | Return a schema for three-digit and six-digit hexadecimal colors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L162) |
| `getJsonValueSchema` | Return a bounded, acyclic JSON-value schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L142) |
| `getNonEmptyStringSchema` | Return a schema for non-empty strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L23) |
| `getNonNegativeIntSchema` | Return a schema for non-negative safe integers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L40) |
| `getPaginationSchema` | Return the shared positive-safe-integer pagination-query schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L51) |
| `getPhoneNumberSchema` | Return the shared E.164-compatible phone-number schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L46) |
| `getPortNumberSchema` | Return a schema for TCP and UDP port numbers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L50) |
| `getPositiveIntSchema` | Return a schema for positive safe integers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L30) |
| `getSemverSchema` | Return a bounded Semantic Versioning schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L169) |
| `getSlugSchema` | Return the shared lowercase slug schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L38) |
| `getStrongPasswordSchema` | Return the shared bounded password-strength schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L95) |
| `getTimestampSchema` | Return a schema for bounded ISO date-time strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/primitives.ts#L60) |
| `getUrlSchema` | Return the shared bounded URL schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L42) |
| `getUuidSchema` | Return the shared UUID schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L36) |
