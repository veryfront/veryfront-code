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
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
  RefinementCtx,
  SchemaFactory,
  ValidationResult,
} from "./schema-validator.ts";

// Interfaces
export type {
  JsonSchemaValidationFailure,
  JsonSchemaValidationIssue,
  JsonSchemaValidationSuccess,
  Schema,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationFailure,
  ValidationIssue,
  ValidationSuccess,
} from "./schema-validator.ts";
