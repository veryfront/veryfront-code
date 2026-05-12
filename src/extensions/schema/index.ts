/**
 * Schema category barrel — SchemaValidator contract and inference helpers.
 *
 * @module extensions/schema
 */

// Type aliases (generic helpers + unions)
export type {
  InferInput,
  InferSchema,
  InferShape,
  JsonSchema,
  RefinementCtx,
  SchemaFactory,
  ValidationResult,
} from "./schema-validator.ts";

// Interfaces
export type {
  Schema,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationFailure,
  ValidationIssue,
  ValidationSuccess,
} from "./schema-validator.ts";
