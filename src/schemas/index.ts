/**
 * Reusable validation schemas — common types (email, slug, URL, UUID,
 * pagination) and primitives (file paths, hex colors, semver, timestamps),
 * plus the `defineSchema` lazy-factory helper.
 *
 * Importing this module also registers the default zod-backed
 * `SchemaValidator` adapter so that `defineSchema(...)` works out of the box.
 *
 * @module schemas
 */

import { registerZodAdapter } from "./zod-adapter.ts";

// Register the default SchemaValidator implementation once at module load.
registerZodAdapter();

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
