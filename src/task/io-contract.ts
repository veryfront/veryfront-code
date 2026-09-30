/**
 * Declared task schema checks, warning phase (veryfront/veryfront-issue-inbox#2108).
 *
 * Validation happens once, here in the runtime. Submitted `input` that violates the declared
 * `inputSchema` fails before user code runs. Everything else is recorded as a schema violation
 * and the run completes as before: config that violates `inputSchema` on a config-only run, a
 * return value that violates `outputSchema`, and a raw JSON Schema that no validator can
 * compile (reported as unenforced, never as enforced). Failing those is the enforcement phase.
 *
 * @module task/io-contract
 */

import type { JsonSchemaValidationIssue, Schema } from "#veryfront/extensions/schema/index.ts";
import { tryCompileJsonSchemaValidator } from "#veryfront/schemas/json-schema.ts";
import { isContractSchema, snapshotJsonSchemaObject } from "#veryfront/schemas/schema-input.ts";
import {
  escapePointerSegment,
  MAX_SCHEMA_VALIDATION_ERRORS,
  type SchemaValidationError,
  toSchemaValidationErrors,
} from "#veryfront/schemas/validation-errors.ts";

export type { SchemaValidationError };

export type SchemaViolationPhase = "input" | "output" | "identity";
export type SchemaViolationReason =
  | "invalid"
  | "schema_uncompilable"
  | "identity_missing"
  | "identity_mismatch";

/** Recorded on `run.metadata.schema_violation`. */
export interface SchemaViolation {
  phase: SchemaViolationPhase;
  reason: SchemaViolationReason;
  schema_sha256: string | null;
  errors: SchemaValidationError[];
  detected_at: string;
}

export type SchemaCheck =
  | { outcome: "valid"; value: unknown }
  | { outcome: "invalid"; errors: SchemaValidationError[] }
  | { outcome: "schema_uncompilable" };

function fromJsonSchemaIssues(
  issues: readonly JsonSchemaValidationIssue[],
): SchemaValidationError[] {
  // Index loops, not slice/map: task code may have replaced Array methods before its output
  // is checked, and a warning-phase mismatch must still be recorded rather than throw.
  const errors: SchemaValidationError[] = [];
  const count = issues.length < MAX_SCHEMA_VALIDATION_ERRORS
    ? issues.length
    : MAX_SCHEMA_VALIDATION_ERRORS;
  for (let index = 0; index < count; index++) {
    const issue = issues[index]!;
    // A missing required property is reported on its parent; name the property itself.
    const missing = issue.keyword === "required" ? issue.params.missingProperty : undefined;
    const path = typeof missing === "string"
      ? `${issue.instancePath}/${escapePointerSegment(missing)}`
      : issue.instancePath;
    errors[errors.length] = { path, message: issue.message ?? `failed ${issue.keyword}` };
  }
  return errors;
}

/** Validate a value against a declared contract schema or raw JSON Schema. */
export async function checkDeclaredSchema(schema: unknown, value: unknown): Promise<SchemaCheck> {
  if (isContractSchema(schema)) {
    const result = (schema as Schema<unknown>).safeParse(value);
    if (result.success) return { outcome: "valid", value: result.data };
    return { outcome: "invalid", errors: toSchemaValidationErrors(result.issues) };
  }

  const jsonSchema = snapshotJsonSchemaObject(schema);
  let validate: ReturnType<typeof tryCompileJsonSchemaValidator>;
  try {
    validate = jsonSchema ? tryCompileJsonSchemaValidator(jsonSchema) : undefined;
  } catch {
    validate = undefined;
  }
  if (!validate) return { outcome: "schema_uncompilable" };

  const result = await validate(value);
  return result.success
    ? { outcome: "valid", value: result.value }
    : { outcome: "invalid", errors: fromJsonSchemaIssues(result.errors) };
}

export function createSchemaViolation(
  phase: SchemaViolationPhase,
  check: Exclude<SchemaCheck, { outcome: "valid" }>,
  schemaSha256: string | null,
): SchemaViolation {
  return {
    phase,
    reason: check.outcome === "invalid" ? "invalid" : "schema_uncompilable",
    schema_sha256: schemaSha256,
    errors: check.outcome === "invalid" ? check.errors : [],
    detected_at: new Date().toISOString(),
  };
}

export { schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
