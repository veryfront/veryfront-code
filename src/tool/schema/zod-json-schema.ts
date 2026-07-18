/**
 * Schema → JSON Schema conversion shim.
 *
 * Historically this module was the in-tree zod-to-JSON-Schema converter.
 * After Phase B2 the conversion lives behind the `SchemaValidator`
 * contract (`toJsonSchema` / `isOptional`) and the zod-aware logic moved
 * to `extensions/ext-schema-zod/src/json-schema.ts`. This file is kept as a
 * back-compat surface so existing callers (`tool/registry.ts`,
 * `tool/factory.ts`, `workflow/registry.ts`, `routing/api/openapi/...`,
 * `mcp/server.ts`, `cli/mcp/server.ts`) continue to compile.
 *
 * Inputs must be opaque `Schema<T>` values produced by `defineSchema`.
 * Conversion is routed through the `SchemaValidator` contract so no
 * zod-specific logic remains in this file.
 *
 * @module tool/schema/zod-json-schema
 */

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  isOptionalSchema as schemaIsOptional,
  schemaToJsonSchema,
} from "#veryfront/schemas/json-schema.ts";

/** Detect contract `Schema<T>` (carries a `__zod` brand from the ext-schema-zod adapter). */
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

/**
 * Convert a `Schema<T>` into a JSON Schema document.
 *
 * Throws if the input is not a contract schema.
 */
export function zodToJsonSchema(schema: unknown): JsonSchema {
  if (isContractSchema(schema)) {
    return schemaToJsonSchema(schema);
  }
  throw INVALID_ARGUMENT.create({ detail: "Invalid Veryfront schema: use defineSchema()" });
}

/**
 * Returns `true` when the schema permits `undefined`.
 */
export function isOptionalSchema(schema: unknown): boolean {
  if (isContractSchema(schema)) {
    return schemaIsOptional(schema);
  }
  return false;
}
