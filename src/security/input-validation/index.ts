/**
 * Input Validation Module
 * Comprehensive input validation system for API handlers
 *
 * @module @veryfront/security/input-validation
 */

// Types
export type { ParseFormOptions, ParseJsonOptions, RequestLimits, ValidatedData } from "./types.ts";
export { DEFAULT_LIMITS } from "./types.ts";

// Errors
export { ValidationError } from "./errors.ts";

// Limit validators
export { readBodyWithLimit, validateRequestLimits } from "./limits.ts";

// Parsers
export { parseFormData, parseJsonBody, parseQueryParams } from "./parsers.ts";

// Sanitizers
export { sanitizeData } from "./sanitizers.ts";

// Common schemas
export { CommonSchemas } from "./schemas.ts";

// Handler factory
export {
  createValidatedHandler,
  type ValidatedHandlerConfig,
  type ValidatedHandlerFunction,
} from "./handler.ts";
