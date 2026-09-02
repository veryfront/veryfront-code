/**
 * Security layer for input validation with size limits, application authentication,
 * CORS configuration, CSP and security headers, path traversal prevention, and secure
 * filesystem access.
 *
 * @module security
 *
 * @example Apply response security headers
 * ```ts
 * import { applySecurityHeaders, generateNonce } from "veryfront/security";
 *
 * const response = new Response("Ready");
 * applySecurityHeaders(response.headers, false, generateNonce(), null);
 * ```
 */

export { BaseHandler } from "./http/base-handler.ts";
export type { HandlerHelpers } from "./http/base-handler.ts";

export {
  CommonSchemas,
  createValidatedHandler,
  createValidationError,
  DEFAULT_LIMITS,
  INPUT_VALIDATION_FAILED,
  isRequestBodyTooLargeError,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  readBodyWithLimit,
  sanitizeData,
  validateRequestLimits,
} from "./input-validation/index.ts";
export type {
  ApplicationIdentity,
  AuthClaimPrimitive,
  AuthClaimValue,
  SerializedApplicationIdentity,
  SerializedAuthClaims,
} from "./application-auth/types.ts";

export type {
  ParseFormOptions,
  ParseJsonOptions,
  ParseQueryOptions,
  RequestLimits,
  ValidatedData,
  ValidatedHandlerConfig,
  ValidatedHandlerFunction,
} from "./input-validation/index.ts";

export { AuthHandler, isAuthGateEnabled } from "./http/auth.ts";
export { isValidSecurityConfig, loadSecurityConfig, SecurityConfigLoader } from "./http/config.ts";
export { setCors } from "./http/middleware/index.ts";
export type {
  AuthConfig,
  BasicAuthConfig,
  BearerAuthConfig,
  CORSConfig,
  CSPDirectives,
  OidcAuthConfig,
  SecurityConfig,
  TrustedProxyAuthConfig,
} from "./http/middleware/index.ts";

export { CsrfHandler } from "./http/csrf/index.ts";
export { applyCsrfCookie, generateCsrfToken, validateCsrf } from "./csrf/index.ts";
export type { CsrfConfig, CsrfTokenOptions } from "./csrf/index.ts";

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
  SyncCORSConfig,
  SyncCORSHeaderOptions,
  SyncOriginValidator,
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
  validateLexicalPath,
  validatePath,
  validatePathSync,
  ValidationPresets,
} from "./path-validation.ts";
export type {
  LexicalPathValidationOptions,
  PathValidationPolicyOptions,
  ValidationLevel,
  ValidationOptions,
  ValidationResult,
} from "./path-validation.ts";

export {
  createSecureFs,
  SecureFs,
  SECURITY_VIOLATION,
  wrapAdapterWithSecurity,
} from "./secure-fs.ts";
export type { SecureFsConfig, SecurityContext, SecurityEvent } from "./secure-fs.ts";

export {
  BUILD_HELPER_PERMISSIONS,
  SERVER_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
} from "./deno-permissions.ts";
