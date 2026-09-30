/**
 * Schema identity: the sha256 of a schema's canonical JSON Schema document.
 *
 * A run records the identity of the input and output schema it ran against, so
 * a consumer can tell which contract a stored value satisfies. The backend
 * computes the same identity from the same canonical form, so both sides must
 * agree byte for byte:
 *
 * - A contract schema (`defineSchema`, `Schema<T>`) is converted with
 *   `schemaToJsonSchema` first. A raw JSON Schema object is used as is.
 * - Object keys are sorted by UTF-16 code unit order at every depth. Array
 *   order is kept.
 * - The document is serialized with `JSON.stringify` and no whitespace, then
 *   hashed as UTF-8. The identity is the lowercase 64-character hex digest.
 *
 * @module schemas/schema-identity
 */

import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { schemaToJsonSchema } from "./json-schema.ts";
import { isCallableContractSchema, snapshotJsonSchemaObject } from "./schema-input.ts";

// Captured at module load, before any project module runs: a task module that replaces these
// in the shared realm must not be able to fail or forge the identity.
const arrayIsArray = Array.isArray;
const arrayPrototypeSort = Array.prototype.sort;
const jsonStringify = JSON.stringify;
const objectKeys = Object.keys;
const reflectApply = Reflect.apply;

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Serialize like `JSON.stringify` with keys sorted at every depth. Containers are walked here
 * and only primitives reach `JSON.stringify`, so no `toJSON` a project installs on a prototype
 * is ever called, and an own `__proto__` key is written like any other key.
 */
function serializeCanonical(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? undefined : jsonStringify(value);
  }
  if (arrayIsArray(value)) {
    let out = "[";
    for (let index = 0; index < value.length; index++) {
      if (index > 0) out += ",";
      out += serializeCanonical(value[index]) ?? "null";
    }
    return out + "]";
  }
  // UTF-16 code unit order, byte-identical to the veryfront-api helper; not locale-dependent.
  const keys = reflectApply(arrayPrototypeSort, objectKeys(value), [compareCodeUnits]) as string[];
  let out = "{";
  let first = true;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const serialized = serializeCanonical((value as Record<string, unknown>)[key]);
    if (serialized === undefined) continue;
    out += `${first ? "" : ","}${jsonStringify(key)}:${serialized}`;
    first = false;
  }
  return out + "}";
}

/**
 * Resolve a declared schema to its JSON Schema document, or `undefined` when
 * the value is neither a contract schema nor a JSON object.
 */
export function resolveJsonSchemaDocument(schema: unknown): JsonSchema | undefined {
  if (isCallableContractSchema(schema)) return schemaToJsonSchema(schema);
  return snapshotJsonSchemaObject(schema);
}

/** Serialize a JSON Schema document in the canonical form the identity hashes. */
export function canonicalJsonSchema(schema: unknown): string | undefined {
  const document = resolveJsonSchemaDocument(schema);
  return document === undefined ? undefined : serializeCanonical(document);
}

/**
 * Return the schema identity (lowercase sha256 hex of the canonical JSON Schema),
 * or `null` when no schema is declared or it has no JSON Schema form.
 */
export async function schemaIdentitySha256(schema: unknown): Promise<string | null> {
  if (schema === undefined || schema === null) return null;
  let canonical: string | undefined;
  try {
    canonical = canonicalJsonSchema(schema);
  } catch {
    return null;
  }
  return canonical === undefined ? null : await computeHash(canonical);
}
