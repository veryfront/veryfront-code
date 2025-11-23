/**
 * Response Builder - Public API
 * Fluent API for constructing HTTP responses with common patterns
 */

// Re-export types
export type { CacheStrategy, CORSConfig, ResponseBuilderConfig, SecurityConfig } from "./types.ts";

// Re-export constants
export { CACHE_DURATIONS, CONTENT_TYPES } from "./constants.ts";

// Re-export main builder
export { createResponseBuilder, ResponseBuilder } from "./builder.ts";

// Re-export handler utilities (for advanced usage)
export { applyCORSHeaders, shouldApplyCORS } from "../cors/index.ts";
export {
  applySecurityHeaders,
  buildCSP,
  generateNonce,
  getSecurityHeader,
} from "./security-handler.ts";
export { buildCacheControl } from "./cache-handler.ts";
