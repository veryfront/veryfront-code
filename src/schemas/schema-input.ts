/**
 * Shared detection for the `Schema<T> | JsonSchema` inputs the public
 * `tool()` and `agent()` surfaces accept.
 *
 * Both surfaces take either a materialized contract schema or a raw JSON
 * Schema document, and both must tell them apart the same way, so the
 * predicates live here rather than beside either caller.
 *
 * @module schemas/schema-input
 */

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "./json-value.ts";

export function snapshotJsonSchemaObject(value: unknown): JsonSchema | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  return snapshot.success &&
      typeof snapshot.value === "object" &&
      snapshot.value !== null &&
      !Array.isArray(snapshot.value)
    ? snapshot.value
    : undefined;
}

// Inferring "this is a raw JSON Schema" from an unknown value needs positive
// evidence. Without it, foreign shapes such as a Zod internal ({ _def: ... })
// would be shipped verbatim to providers as inputSchemaJson. Unions and $ref
// schemas legitimately omit `type`, so membership — not `type` — is the test.
//
// The set is the full draft 2020-12 keyword vocabulary, because a schema whose
// only keyword is a constraint ({ pattern }, { minimum }, { maxItems }) is as
// valid as one carrying `type`, and a partial list rejects it. Keywords are
// grouped by the vocabulary meta-schema that defines them; `definitions` is the
// draft-07 spelling of `$defs`, which providers still emit.
const JSON_SCHEMA_KEYWORDS = new Set([
  // Core
  "$anchor",
  "$comment",
  "$defs",
  "$dynamicAnchor",
  "$dynamicRef",
  "$id",
  "$ref",
  "$schema",
  "$vocabulary",
  "definitions",
  // Applicator
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "dependentSchemas",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "then",
  // Unevaluated
  "unevaluatedItems",
  "unevaluatedProperties",
  // Validation
  "const",
  "dependentRequired",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
  "required",
  "type",
  "uniqueItems",
  // Meta-data
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
  // Format annotation
  "format",
  // Content
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

export function isInferredJsonSchemaObject(value: JsonSchema): boolean {
  return Object.keys(value).some((key) => JSON_SCHEMA_KEYWORDS.has(key));
}

export function isContractSchema(value: unknown): value is Schema<unknown> {
  if (value === null || typeof value !== "object") return false;
  if ("__zod" in value) return true;
  return (
    "_output" in value &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}
