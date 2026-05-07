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
  CommonSchemas,
  type DateRange,
  type Email,
  type Pagination,
  type PhoneNumber,
  type Slug,
  type StrongPassword,
  type Url,
  type Uuid,
} from "./common.ts";

export {
  type AbsolutePath,
  absolutePath,
  type FilePath,
  filePath,
  type HexColor,
  hexColor,
  type JsonValue,
  jsonValue,
  type NonEmptyString,
  nonEmptyString,
  type NonNegativeInt,
  nonNegativeInt,
  type PortNumber,
  portNumber,
  type PositiveInt,
  positiveInt,
  type Semver,
  semver,
  type Timestamp,
  timestamp,
} from "./primitives.ts";
