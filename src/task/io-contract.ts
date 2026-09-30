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
import { schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
import { isContractSchema, snapshotJsonSchemaObject } from "#veryfront/schemas/schema-input.ts";

/** At most this many validation errors are kept on a violation or a failed run. */
export const MAX_SCHEMA_VALIDATION_ERRORS = 20;

export interface SchemaValidationError {
  /** JSON Pointer to the invalid value, `""` for the root. */
  path: string;
  message: string;
}

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

function escapePointerSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function limitErrors(errors: SchemaValidationError[]): SchemaValidationError[] {
  return errors.slice(0, MAX_SCHEMA_VALIDATION_ERRORS);
}

function fromJsonSchemaIssues(
  issues: readonly JsonSchemaValidationIssue[],
): SchemaValidationError[] {
  return limitErrors(issues.map((issue) => {
    // A missing required property is reported on its parent; name the property itself.
    const missing = issue.keyword === "required" ? issue.params.missingProperty : undefined;
    const path = typeof missing === "string"
      ? `${issue.instancePath}/${escapePointerSegment(missing)}`
      : issue.instancePath;
    return { path, message: issue.message ?? `failed ${issue.keyword}` };
  }));
}

/** Validate a value against a declared contract schema or raw JSON Schema. */
export async function checkDeclaredSchema(schema: unknown, value: unknown): Promise<SchemaCheck> {
  if (isContractSchema(schema)) {
    const result = (schema as Schema<unknown>).safeParse(value);
    if (result.success) return { outcome: "valid", value: result.data };
    return {
      outcome: "invalid",
      errors: limitErrors(result.issues.map((issue) => ({
        path: issue.path.length === 0 ? "" : `/${issue.path.map(escapePointerSegment).join("/")}`,
        message: issue.message,
      }))),
    };
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

export { schemaIdentitySha256 };
