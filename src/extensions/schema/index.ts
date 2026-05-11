/**
 * Schema category barrel — SchemaValidator contract and inference helpers.
 *
 * @module extensions/schema
 */

// Type aliases (generic helpers + unions)
export type {
  InferSchema,
  InferInput,
  InferShape,
  SchemaFactory,
  ValidationResult,
  JsonSchema,
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
