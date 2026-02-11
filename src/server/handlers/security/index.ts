/**
 * Security Handlers
 *
 * @deprecated Import from `#veryfront/security/http` directly instead.
 * This module re-exports from security/http for backward compatibility.
 *
 * @module server/handlers/security
 */

export {
  type AuthConfig,
  AuthHandler,
  type BasicAuthConfig,
  type BearerAuthConfig,
  type ColorScheme,
  type ColorSchemeResult,
  type CORSConfig,
  type CSPDirectives,
  getColorSchemeFromRequest,
  isValidSecurityConfig,
  loadSecurityConfig,
  type SecurityConfig,
  SecurityConfigLoader,
  setCors,
} from "#veryfront/security/http/index.ts";
