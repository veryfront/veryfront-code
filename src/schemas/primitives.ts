import { z } from "zod";

/**
 * Primitive validation schemas for basic reusable types.
 * These provide foundational building blocks for more complex schemas.
 */

/**
 * Non-empty string - ensures string has at least one character
 */
export const nonEmptyString = z.string().min(1, "String cannot be empty");
export type NonEmptyString = z.infer<typeof nonEmptyString>;

/**
 * Positive integer - ensures number is an integer greater than 0
 */
export const positiveInt = z.number().int().positive("Must be a positive integer");
export type PositiveInt = z.infer<typeof positiveInt>;

/**
 * Non-negative integer - ensures number is an integer >= 0
 */
export const nonNegativeInt = z.number().int().nonnegative("Must be a non-negative integer");
export type NonNegativeInt = z.infer<typeof nonNegativeInt>;

/**
 * Port number - validates network port (1-65535)
 */
export const portNumber = z.number().int().min(1).max(65535, "Port must be between 1 and 65535");
export type PortNumber = z.infer<typeof portNumber>;

/**
 * Timestamp - ISO 8601 datetime string
 */
export const timestamp = z.string().datetime();
export type Timestamp = z.infer<typeof timestamp>;

/**
 * JSON value - any valid JSON value
 */
export const jsonValue: z.ZodType<
  string | number | boolean | null | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(jsonValue),
  ])
);
export type JsonValue = z.infer<typeof jsonValue>;

/**
 * Hex color - validates hex color code (#RGB or #RRGGBB)
 */
export const hexColor = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color");
export type HexColor = z.infer<typeof hexColor>;

/**
 * Semantic version - validates semver format
 */
export const semver = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  "Invalid semantic version",
);
export type Semver = z.infer<typeof semver>;

/**
 * File path - non-empty string representing a file path
 */
export const filePath = z.string().min(1, "File path cannot be empty");
export type FilePath = z.infer<typeof filePath>;

/**
 * Absolute path - validates absolute file paths (starts with / or drive letter)
 */
export const absolutePath = z.string().regex(
  /^(?:\/|[A-Za-z]:\\)/,
  "Path must be absolute (start with / or drive letter)",
);
export type AbsolutePath = z.infer<typeof absolutePath>;
