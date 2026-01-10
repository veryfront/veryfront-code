/**
 * Security middleware - barrel exports
 *
 * @module security/middleware
 */

// Types
export type {
  AuthConfig,
  BasicAuthConfig,
  BearerAuthConfig,
  CORSConfig,
  CSPDirectives,
  SecurityConfig,
} from "./types.ts";

// Config loader
export { isValidSecurityConfig, loadSecurityConfig } from "./config-loader.ts";

// CORS handler
export { setCors } from "./cors-handler.ts";

// ETag utilities
export { computeEtag } from "./etag.ts";

// Content types
export { CONTENT_TYPES } from "./content-types.ts";
