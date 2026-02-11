/**
 * Security Http
 *
 * @module security/http
 */

export { AuthHandler } from "./auth.ts";
export {
  type ColorScheme,
  type ColorSchemeResult,
  getColorSchemeFromRequest,
} from "./client-hints.ts";
export { SecurityConfigLoader } from "./config.ts";
export type {
  AuthConfig,
  BasicAuthConfig,
  BearerAuthConfig,
  CORSConfig,
  CSPDirectives,
  SecurityConfig,
} from "./middleware/index.ts";
export { isValidSecurityConfig, loadSecurityConfig } from "./middleware/index.ts";
export { setCors } from "./middleware/index.ts";
