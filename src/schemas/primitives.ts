/**
 * Reusable validation primitives, expressed against the `SchemaValidator`
 * contract via `defineSchema`. Each export is a lazy getter. Calling it
 * materializes (and caches) the schema on first use.
 *
 * @module schemas/primitives
 */

import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import {
  MAX_PATH_LENGTH_CHARS,
  MAX_PORT_NUMBER,
  MIN_PORT_NUMBER,
} from "#veryfront/utils/constants/limits.ts";
import { defineSchema } from "./define.ts";

const MAX_JSON_VALUE_DEPTH = 100;
const MAX_JSON_VALUE_NODES = 100_000;
const MAX_SEMVER_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;

/** Return a schema for non-empty strings. */
export const getNonEmptyStringSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1, "String cannot be empty")
);
/** Validated non-empty string. */
export type NonEmptyString = InferSchema<ReturnType<typeof getNonEmptyStringSchema>>;

/** Return a schema for positive safe integers. */
export const getPositiveIntSchema: () => Schema<number> = defineSchema((v) =>
  v.number().int().positive("Must be a positive integer").refine(
    Number.isSafeInteger,
    "Must be a safe integer",
  )
);
/** Validated positive safe integer. */
export type PositiveInt = InferSchema<ReturnType<typeof getPositiveIntSchema>>;

/** Return a schema for non-negative safe integers. */
export const getNonNegativeIntSchema: () => Schema<number> = defineSchema((v) =>
  v.number().int().nonnegative("Must be a non-negative integer").refine(
    Number.isSafeInteger,
    "Must be a safe integer",
  )
);
/** Validated non-negative safe integer. */
export type NonNegativeInt = InferSchema<ReturnType<typeof getNonNegativeIntSchema>>;

/** Return a schema for TCP and UDP port numbers. */
export const getPortNumberSchema: () => Schema<number> = defineSchema((v) =>
  v.number().int().min(MIN_PORT_NUMBER).max(
    MAX_PORT_NUMBER,
    `Port must be between ${MIN_PORT_NUMBER} and ${MAX_PORT_NUMBER}`,
  )
);
/** Validated port number from 1 through 65,535. */
export type PortNumber = InferSchema<ReturnType<typeof getPortNumberSchema>>;

/** Return a schema for bounded ISO date-time strings. */
export const getTimestampSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_TIMESTAMP_LENGTH).datetime()
);
/** Validated ISO date-time string. */
export type Timestamp = InferSchema<ReturnType<typeof getTimestampSchema>>;

/**
 * Recursive JSON value type: a string, number, boolean, null, array of
 * JsonValue, or object with string keys and JsonValue values.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonTraversalFrame =
  | { readonly depth: number; readonly value: unknown }
  | { readonly exit: object };

function isBoundedJsonValue(value: unknown): value is JsonValue {
  const ancestors = new WeakSet<object>();
  const stack: JsonTraversalFrame[] = [{ depth: 0, value }];
  let nodeCount = 0;

  try {
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if ("exit" in frame) {
        ancestors.delete(frame.exit);
        continue;
      }

      nodeCount++;
      if (nodeCount > MAX_JSON_VALUE_NODES || frame.depth > MAX_JSON_VALUE_DEPTH) return false;
      const current = frame.value;
      if (
        current === null || typeof current === "string" || typeof current === "boolean"
      ) {
        continue;
      }
      if (typeof current === "number") {
        if (!Number.isFinite(current)) return false;
        continue;
      }
      if (typeof current !== "object") return false;

      const prototype = Object.getPrototypeOf(current);
      if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
        return false;
      }
      if (ancestors.has(current)) return false;
      ancestors.add(current);
      stack.push({ exit: current });

      if (Array.isArray(current)) {
        if (current.length > MAX_JSON_VALUE_NODES - nodeCount) return false;
        for (let index = current.length - 1; index >= 0; index--) {
          if (!Object.hasOwn(current, index)) return false;
          stack.push({ depth: frame.depth + 1, value: Reflect.get(current, index) });
        }
        continue;
      }

      const keys = Object.keys(current);
      if (keys.length > MAX_JSON_VALUE_NODES - nodeCount) return false;
      for (let index = keys.length - 1; index >= 0; index--) {
        stack.push({
          depth: frame.depth + 1,
          value: Reflect.get(current, keys[index]!),
        });
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Return a bounded, acyclic JSON-value schema. */
export const getJsonValueSchema: () => Schema<JsonValue> = defineSchema<JsonValue>(
  (v): Schema<JsonValue> => {
    const recursiveSchema: Schema<JsonValue> = v.lazy<JsonValue>(() =>
      v.union([
        v.string(),
        v.number(),
        v.boolean(),
        v.null(),
        v.array(recursiveSchema),
        v.record(v.string(), recursiveSchema),
      ]) as Schema<JsonValue>
    );
    return v.custom<JsonValue>(
      isBoundedJsonValue,
      "JSON value exceeds the supported structure limits",
    ).pipe(recursiveSchema);
  },
);

/** Return a schema for three-digit and six-digit hexadecimal colors. */
export const getHexColorSchema: () => Schema<string> = defineSchema((v) =>
  v.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color")
);
/** Validated hexadecimal color string. */
export type HexColor = InferSchema<ReturnType<typeof getHexColorSchema>>;

/** Return a bounded Semantic Versioning schema. */
export const getSemverSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_SEMVER_LENGTH).regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    "Invalid semantic version",
  )
);
/** Validated semantic-version string. */
export type Semver = InferSchema<ReturnType<typeof getSemverSchema>>;

/** Return a bounded filesystem-path representation schema. */
export const getFilePathSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1, "File path cannot be empty").max(
    MAX_PATH_LENGTH_CHARS,
    `File path must be at most ${MAX_PATH_LENGTH_CHARS} characters`,
  ).refine((path) => !path.includes("\0"), "File path cannot contain NUL bytes")
);
/** Validated filesystem-path representation. */
export type FilePath = InferSchema<ReturnType<typeof getFilePathSchema>>;

/** Return a schema for bounded absolute POSIX, drive-letter, and UNC paths. */
export const getAbsolutePathSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(
    MAX_PATH_LENGTH_CHARS,
    `Path must be at most ${MAX_PATH_LENGTH_CHARS} characters`,
  ).refine((path) => !path.includes("\0"), "Path cannot contain NUL bytes").regex(
    /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/,
    "Path must be an absolute POSIX, drive-letter, or UNC path",
  )
);
/** Validated absolute filesystem-path representation. */
export type AbsolutePath = InferSchema<ReturnType<typeof getAbsolutePathSchema>>;
