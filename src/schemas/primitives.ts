/**
 * Reusable validation primitives, expressed against the `SchemaValidator`
 * contract via `defineSchema`. Each export is a lazy getter — calling it
 * materializes (and caches) the schema on first use.
 *
 * @module schemas/primitives
 */

import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "./define.ts";

const ABSOLUTE_PATH_PATTERN = /^(?:\/|\\(?!\\)|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;
const MIN_PORT_NUMBER = 1;
const MAX_PORT_NUMBER = 65_535;
const isPathWithoutNullBytes = (path: string): boolean => !path.includes("\0");

export const getNonEmptyStringSchema = defineSchema((v) =>
  v.string().min(1, "String cannot be empty")
);
export type NonEmptyString = InferSchema<ReturnType<typeof getNonEmptyStringSchema>>;

export const getPositiveIntSchema = defineSchema((v) =>
  v.number().int().positive("Must be a positive integer")
);
export type PositiveInt = InferSchema<ReturnType<typeof getPositiveIntSchema>>;

export const getNonNegativeIntSchema = defineSchema((v) =>
  v.number().int().nonnegative("Must be a non-negative integer")
);
export type NonNegativeInt = InferSchema<ReturnType<typeof getNonNegativeIntSchema>>;

export const getPortNumberSchema = defineSchema((v) =>
  v
    .number()
    .int()
    .min(MIN_PORT_NUMBER)
    .max(MAX_PORT_NUMBER, `Port must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}`)
);
export type PortNumber = InferSchema<ReturnType<typeof getPortNumberSchema>>;

export const getTimestampSchema = defineSchema((v) => v.string().datetime());
export type Timestamp = InferSchema<ReturnType<typeof getTimestampSchema>>;

/**
 * Recursive JSON value type — a string, number, boolean, null, array of
 * JsonValue, or object with string keys and JsonValue values.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const getJsonValueSchema = defineSchema<JsonValue>((v): Schema<JsonValue> =>
  v.lazy<JsonValue>(() =>
    v.union([
      v.string(),
      v.number(),
      v.boolean(),
      v.null(),
      v.array(getJsonValueSchema()),
      v.record(v.string(), getJsonValueSchema()),
    ]) as Schema<JsonValue>
  )
);

export const getHexColorSchema = defineSchema((v) =>
  v.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color")
);
export type HexColor = InferSchema<ReturnType<typeof getHexColorSchema>>;

export const getSemverSchema = defineSchema((v) =>
  v.string().regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    "Invalid semantic version",
  )
);
export type Semver = InferSchema<ReturnType<typeof getSemverSchema>>;

export const getFilePathSchema = defineSchema((v) =>
  v
    .string()
    .min(1, "File path cannot be empty")
    .refine(isPathWithoutNullBytes, "File path cannot contain null bytes")
);
export type FilePath = InferSchema<ReturnType<typeof getFilePathSchema>>;

export const getAbsolutePathSchema = defineSchema((v) =>
  v
    .string()
    .regex(
      ABSOLUTE_PATH_PATTERN,
      "Path must start at a filesystem root, drive letter, or UNC share",
    )
    .refine(isPathWithoutNullBytes, "Path cannot contain null bytes")
);
export type AbsolutePath = InferSchema<ReturnType<typeof getAbsolutePathSchema>>;
