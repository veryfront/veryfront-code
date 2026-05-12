/**
 * Schema → JSON Schema conversion shim.
 *
 * Historically this module was the in-tree zod-to-JSON-Schema converter.
 * After Phase B2 the conversion lives behind the `SchemaValidator`
 * contract (`toJsonSchema` / `isOptional`) and the zod-aware logic moved
 * to `extensions/ext-zod/src/json-schema.ts`. This file is kept as a
 * back-compat surface so existing callers (`tool/registry.ts`,
 * `tool/factory.ts`, `workflow/registry.ts`, `routing/api/openapi/...`,
 * `mcp/server.ts`, `cli/mcp/server.ts`) continue to compile.
 *
 * Inputs may be either an opaque `Schema<T>` produced by `defineSchema`
 * (the modern path) or a raw zod schema (legacy path during the migration
 * window). Both shapes are routed through the `SchemaValidator` contract
 * so no zod-specific logic remains in this file.
 *
 * @module tool/schema/zod-json-schema
 */

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import {
  isOptionalSchema as schemaIsOptional,
  schemaToJsonSchema,
} from "#veryfront/schemas/json-schema.ts";

/** Detect contract `Schema<T>` (carries a `__zod` brand from the ext-zod adapter). */
function isContractSchema(value: unknown): value is Schema<unknown> {
  if (value === null || typeof value !== "object") return false;
  if ("__zod" in value) return true;
  // Fallback: defineSchema-produced wrappers expose `_output`, `parse`, and
  // `safeParse`. Some test doubles may construct these directly.
  return (
    "_output" in value &&
    typeof (value as { parse?: unknown }).parse === "function" &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/** Detect a raw zod schema: object with `_def` carrying `typeName` (v3) or `type` (v4). */
function isRawZodSchema(value: unknown): value is { _def: { typeName?: string; type?: string } } {
  if (value === null || typeof value !== "object") return false;
  if (!("_def" in value)) return false;
  const def = (value as { _def: unknown })._def as { typeName?: unknown; type?: unknown } | null;
  if (!def || typeof def !== "object") return false;
  return typeof def.typeName === "string" || typeof def.type === "string";
}

/**
 * Adapter that wraps a raw zod schema in the contract's `Schema<unknown>`
 * shape so the contract's `toJsonSchema` / `isOptional` can unwrap it via
 * the `__zod` brand.
 */
function wrapRawZod(value: unknown): Schema<unknown> {
  return { __zod: value } as unknown as Schema<unknown>;
}

/**
 * Convert a `Schema<T>` (or, transitionally, a raw zod schema) into a
 * JSON Schema document.
 *
 * Throws if the input is neither a contract schema nor a raw zod schema —
 * matches the pre-B2 behavior of the original `zodToJsonSchema` guard.
 */
export function zodToJsonSchema(schema: unknown): JsonSchema {
  if (isContractSchema(schema)) {
    return schemaToJsonSchema(schema);
  }
  if (isRawZodSchema(schema)) {
    return schemaToJsonSchema(wrapRawZod(schema));
  }
  throw new Error("Invalid Zod schema: missing _def property");
}

/**
 * Returns `true` when the schema permits `undefined`. Accepts both
 * contract `Schema<T>` and raw zod schemas for the same compatibility
 * reasons as `zodToJsonSchema` above.
 */
export function isOptionalSchema(schema: unknown): boolean {
  if (isContractSchema(schema)) {
    return schemaIsOptional(schema);
  }
  if (isRawZodSchema(schema)) {
    return schemaIsOptional(wrapRawZod(schema));
  }
  return false;
}
