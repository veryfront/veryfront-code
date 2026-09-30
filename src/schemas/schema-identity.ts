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
import { isContractSchema, snapshotJsonSchemaObject } from "./schema-input.ts";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  // UTF-16 code unit order, byte-identical to the veryfront-api helper; not locale-dependent.
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Resolve a declared schema to its JSON Schema document, or `undefined` when
 * the value is neither a contract schema nor a JSON object.
 */
export function resolveJsonSchemaDocument(schema: unknown): JsonSchema | undefined {
  if (isContractSchema(schema)) return schemaToJsonSchema(schema);
  return snapshotJsonSchemaObject(schema);
}

/** Serialize a JSON Schema document in the canonical form the identity hashes. */
export function canonicalJsonSchema(schema: unknown): string | undefined {
  const document = resolveJsonSchemaDocument(schema);
  return document === undefined ? undefined : JSON.stringify(canonicalize(document));
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
