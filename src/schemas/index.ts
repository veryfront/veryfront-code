/**
 * Reusable validation schemas and the `defineSchema` helper.
 *
 * @example
 * ```ts
 * import { CommonSchemas, defineSchema } from "veryfront/schemas";
 *
 * const email = CommonSchemas.email.parse("user@example.com");
 *
 * const getUserSchema = defineSchema((v) =>
 *   v.object({
 *     id: v.string().uuid(),
 *     name: v.string().min(1),
 *   })
 * );
 * ```
 *
 * @module schemas
 */

export { defineSchema } from "./define.ts";
export { lazySchema } from "./lazy.ts";

export type {
  InferInput,
  InferSchema,
  InferShape,
  JsonSchemaTypeName,
  RefinementCtx,
  Schema,
  SchemaFactory,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";

export {
  isOptionalSchema as schemaIsOptional,
  type JsonSchema,
  schemaToJsonSchema,
} from "./json-schema.ts";

export {
  type CommonSchemaRegistry,
  CommonSchemas,
  type DateRange,
  type Email,
  getDateRangeSchema,
  getEmailSchema,
  getPaginationSchema,
  getPhoneNumberSchema,
  getSlugSchema,
  getStrongPasswordSchema,
  getUrlSchema,
  getUuidSchema,
  type Pagination,
  type PhoneNumber,
  type Slug,
  type StrongPassword,
  type Url,
  type Uuid,
} from "./common.ts";

export {
  type AbsolutePath,
  type FilePath,
  getAbsolutePathSchema,
  getFilePathSchema,
  getHexColorSchema,
  getJsonValueSchema,
  getNonEmptyStringSchema,
  getNonNegativeIntSchema,
  getPortNumberSchema,
  getPositiveIntSchema,
  getSemverSchema,
  getTimestampSchema,
  type HexColor,
  type JsonValue,
  type NonEmptyString,
  type NonNegativeInt,
  type PortNumber,
  type PositiveInt,
  type Semver,
  type Timestamp,
} from "./primitives.ts";
