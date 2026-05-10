/**
 * Reusable validation schemas — common types (email, slug, URL, UUID,
 * pagination) and primitives (file paths, hex colors, semver, timestamps),
 * plus the `defineSchema` lazy-factory helper.
 *
 * `defineSchema` resolves the `SchemaValidator` contract on first use. The
 * default zod-backed implementation lives in `@veryfront/ext-zod` and is
 * registered at app bootstrap by `createBuiltinExtensions()`. Tests that
 * exercise schemas without going through full bootstrap import
 * `./_test-setup.ts` to register the adapter directly.
 *
 * @module schemas
 */

export { defineSchema } from "./define.ts";

export {
  isOptionalSchema as schemaIsOptional,
  type JsonSchema,
  schemaToJsonSchema,
} from "./json-schema.ts";

export {
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
