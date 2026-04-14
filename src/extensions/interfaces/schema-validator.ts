/**
 * Contract interface for schema validation.
 *
 * Default implementation: `@veryfront/ext-zod`
 *
 * @module extensions/interfaces/schema-validator
 */

/** An opaque schema definition that validates and infers type `T`. */
export interface Schema<T = unknown> {
  /** Brand field for nominal typing -- not used at runtime. */
  readonly _output: T;
}

/** A single validation issue with location context. */
export interface ValidationIssue {
  /** Dot-path to the offending field (e.g. `"user.email"`). */
  path: (string | number)[];
  /** Human-readable error message. */
  message: string;
  /** Machine-readable error code. */
  code?: string;
}

/** Successful validation outcome. */
export interface ValidationSuccess<T> {
  success: true;
  /** Parsed and validated data. */
  data: T;
}

/** Failed validation outcome. */
export interface ValidationFailure {
  success: false;
  /** List of issues found during validation. */
  issues: ValidationIssue[];
}

/** Discriminated union of validation outcomes. */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * SchemaValidator contract interface.
 *
 * Implementations validate unknown input against a typed schema and
 * return a discriminated success/failure result.
 */
export interface SchemaValidator {
  /** Validate `data` against the given schema. */
  validate<T>(schema: Schema<T>, data: unknown): ValidationResult<T>;
}
