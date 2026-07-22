/**
 * Reusable validation schemas and the `defineSchema` helper.
 *
 * Schema materialization requires a registered `SchemaValidator`. Veryfront
 * runtime bootstrap registers the built-in validator before handlers run.
 * `lazySchema` keeps module-scope schema constants import-safe before bootstrap.
 *
 * @example
 * ```ts
 * import { CommonSchemas, defineSchema, lazySchema } from "veryfront/schemas";
 *
 * const getUserSchema = defineSchema((v) =>
 *   v.object({
 *     id: v.string().uuid(),
 *     name: v.string().min(1),
 *   })
 * );
 * export const UserSchema = lazySchema(getUserSchema);
 *
 * export function parseEmail(input: unknown) {
 *   return CommonSchemas.email.parse(input);
 * }
 * ```
 *
 * @module schemas
 */

export { defineSchema } from "./define.ts";
export { lazySchema } from "./lazy.ts";

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
