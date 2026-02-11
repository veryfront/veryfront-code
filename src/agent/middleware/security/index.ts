/**
 * Middleware - Security
 *
 * @module agent/middleware/security
 */

export {
  COMMON_BLOCKED_PATTERNS,
  InputValidator,
  OutputFilter,
  type SecurityConfig,
  securityMiddleware,
  type SecurityViolation,
} from "./validator.ts";
