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

type DataProperty = { found: boolean; value?: unknown };

function readDataProperty(value: object, property: PropertyKey): DataProperty {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 32; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, property);
    } catch {
      return { found: false };
    }
    if (descriptor) {
      return "value" in descriptor ? { found: true, value: descriptor.value } : { found: false };
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return { found: false };
    }
  }
  return { found: false };
}

/** Detect contract `Schema<T>` without invoking schema accessors. */
function isContractSchema(value: unknown): value is Schema<unknown> {
  if (value === null || typeof value !== "object") return false;
  if (readDataProperty(value, "__zod").found) return true;

  const output = readDataProperty(value, "_output");
  const parse = readDataProperty(value, "parse");
  const safeParse = readDataProperty(value, "safeParse");
  return output.found && parse.found && typeof parse.value === "function" &&
    safeParse.found && typeof safeParse.value === "function";
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
