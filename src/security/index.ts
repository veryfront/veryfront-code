export { BaseHandler } from "./http/base-handler.ts";
export type { HandlerHelpers } from "./http/base-handler.ts";

export {
  CommonSchemas,
  createValidatedHandler,
  createValidationError,
  DEFAULT_LIMITS,
  INPUT_VALIDATION_FAILED,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  readBodyWithLimit,
  sanitizeData,
  validateRequestLimits,
} from "./input-validation/index.ts";
export type {
  ParseFormOptions,
  ParseJsonOptions,
  RequestLimits,
  ValidatedData,
  ValidatedHandlerConfig,
  ValidatedHandlerFunction,
} from "./input-validation/index.ts";

export {
  AuthHandler,
  loadSecurityConfig,
  SecurityConfigLoader,
  setCors,
} from "./http/handlers-index.ts";
export type { CORSConfig, CSPDirectives, SecurityConfig } from "./http/handlers-index.ts";

export { isValidSecurityConfig } from "./http/middleware/index.ts";

export {
  applyCORSHeaders,
  applyCORSHeadersSync,
  cors,
  corsSimple,
  DEFAULT_HEADERS as DEFAULT_CORS_HEADERS,
  DEFAULT_MAX_AGE as CORS_MAX_AGE,
  DEFAULT_METHODS as DEFAULT_CORS_METHODS,
  handleCORSPreflight,
  isPreflightRequest,
  shouldApplyCORS,
  validateCORSConfig,
  validateOrigin,
  validateOriginSync,
} from "./http/cors/index.ts";
export type {
  CORSConfig as CORSOptions,
  CORSHeaderOptions,
  CORSPreflightOptions,
  CORSValidationResult,
  OriginValidator,
} from "./http/cors/index.ts";

export {
  applySecurityHeaders,
  buildCacheControl,
  CACHE_DURATIONS,
  createResponseBuilder,
  generateNonce,
  getSecurityHeader,
  ResponseBuilder,
} from "./http/response/index.ts";
export type { CacheStrategy, ResponseBuilderConfig } from "./http/response/index.ts";

export {
  createValidator,
  PathValidationError,
  sanitizePathForDisplay,
  validatePath,
  validatePathSync,
  ValidationPresets,
} from "./path-validation.ts";
export type { ValidationLevel, ValidationOptions, ValidationResult } from "./path-validation.ts";

export {
  createSecureFs,
  SecureFs,
  SECURITY_VIOLATION,
  wrapAdapterWithSecurity,
} from "./secure-fs.ts";
export type { SecureFsConfig, SecurityContext, SecurityEvent } from "./secure-fs.ts";
