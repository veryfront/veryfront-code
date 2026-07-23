/**
 * Back-compat re-export. The canonical `JsonSchema` type now lives in
 * `src/extensions/schema/json-schema.ts` so the `SchemaValidator`
 * contract can reference it without an upward import.
 *
 * @module tool/schema/json-schema
 */

export type { JsonSchema, JsonSchemaTypeName } from "#veryfront/extensions/schema/json-schema.ts";
