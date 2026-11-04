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

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { schemaToJsonSchema } from "./json-schema.ts";
import { isCallableContractSchema, snapshotJsonSchemaObject } from "./schema-input.ts";

// Captured at module load, before any project module runs: a task module that replaces these
// in the shared realm must not be able to fail or forge the identity.
const arrayIsArray = Array.isArray;
const arrayPrototypeSort = Array.prototype.sort;
const jsonStringify = JSON.stringify;
const objectKeys = Object.keys;
const objectCreate = Object.create;
const objectDefineProperties = Object.defineProperties;
const objectFreeze = Object.freeze;
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
  const document = typeof schema === "boolean" ? schema : resolveJsonSchemaDocument(schema);
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

/** A detached JSON Schema document and its canonical identity. */
export interface RunSchemaIdentity {
  schema: JsonSchema | boolean;
  sha256: string;
}

/** Missing declarations are captured null; an unconvertible declaration stays unknown. */
export type RunSchemaPairSnapshot =
  | {
    version: 1;
    state: "captured";
    input: RunSchemaIdentity | null;
    output: RunSchemaIdentity | null;
  }
  | { state: "unknown" };

function snapshotDeclaredSchema(schema: unknown): JsonSchema | boolean | null | undefined {
  if (schema === undefined || schema === null) return null;
  return typeof schema === "boolean" ? schema : resolveJsonSchemaDocument(schema);
}

async function identifyDetachedSchema(
  document: JsonSchema | boolean | null,
): Promise<RunSchemaIdentity | null> {
  if (document === null) return null;
  const canonical = serializeCanonical(document);
  if (canonical === undefined) throw new TypeError("Schema snapshot has no canonical form");
  return { schema: document, sha256: await computeHash(canonical) };
}

/**
 * Capture both declarations from one loaded definition before awaiting persistence.
 * Each declaration is read and converted once. Documents use the existing bounded,
 * data-only snapshot boundary; conversion failures never become observed absence.
 */
export async function snapshotRunSchemaPair(
  definition: { readonly inputSchema?: unknown; readonly outputSchema?: unknown },
): Promise<RunSchemaPairSnapshot> {
  try {
    const input = snapshotDeclaredSchema(definition.inputSchema);
    const output = snapshotDeclaredSchema(definition.outputSchema);
    if (input === undefined || output === undefined) return { state: "unknown" };
    return {
      version: 1,
      state: "captured",
      input: await identifyDetachedSchema(input),
      output: await identifyDetachedSchema(output),
    };
  } catch {
    return { state: "unknown" };
  }
}

/**
 * Serialize a completed pair produced by snapshotRunSchemaPair without applying a
 * second, narrower budget to its envelope. Each detached document already has
 * at most 100,000 value nodes, depth 128 and 4 MiB of serialized JSON. This walk
 * therefore visits at most 200,009 nodes at depth 131, and the fixed pair fields
 * add fewer than 256 bytes to the two documents. Array length is not JSON data.
 * Only detached captured pairs belong at this internal serialization boundary.
 */
export function serializeCapturedRunSchemaPair(
  pair: Extract<RunSchemaPairSnapshot, { state: "captured" }>,
): string {
  return serializeCanonical(pair)!;
}

/** Capture validator methods before an acknowledgment can yield to authored code.
 * Callable adapters retain their transforms/refinements and receiver; raw JSON
 * declarations use the exact detached document that was persisted.
 */
export function captureRunSchemaValidation<T>(
  declaration: T,
): (identity: RunSchemaIdentity | null) => T {
  if (!isCallableContractSchema(declaration)) {
    // The declaration's accepted schema representation remains the same at this
    // internal boundary: absent stays absent; raw JSON becomes its detached copy.
    return (identity) => (identity === null ? declaration : identity.schema) as T;
  }
  const safeParse = declaration.safeParse;
  const parse = declaration.parse;
  const pinned: Schema<unknown> = objectCreate(declaration);
  objectDefineProperties(pinned, {
    safeParse: { value: (value: unknown) => reflectApply(safeParse, declaration, [value]) },
    parse: { value: (value: unknown) => reflectApply(parse, declaration, [value]) },
  });
  objectFreeze(pinned);
  // isCallableContractSchema established the Schema surface. The wrapper keeps
  // its original schema type while sealing the two validation entry points.
  return () => pinned as T;
}
