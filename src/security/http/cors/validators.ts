/**
 * CORS Validators
 * Origin validation logic for CORS handling
 *
 * @module core/cors/validators
 */

import type {
  CORSConfig,
  CORSValidationResult,
} from "./types.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
import { recordCorsRejection } from "@veryfront/observability";

/**
 * Validate origin against CORS configuration
 * Returns the allowed origin or null if not allowed
 *
 * This is the main validation entry point that coordinates
 * all origin validation strategies.
 *
 * @param requestOrigin - The origin from the request header
 * @param config - CORS configuration
 * @returns Validation result with allowed origin and credentials
 */
export async function validateOrigin(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): Promise<CORSValidationResult> {
  // Secure by default: no CORS without explicit configuration
  if (!config) {
    return { allowedOrigin: null, allowCredentials: false };
  }

  // Simple boolean true = allow all origins
  if (config === true) {
    const origin = requestOrigin || "*";
    return { allowedOrigin: origin, allowCredentials: false };
  }

  // Object configuration
  const corsConfig = config as CORSConfig;

  // No origin configuration = no CORS
  if (!corsConfig.origin) {
    return { allowedOrigin: null, allowCredentials: false };
  }

  // No origin header (same-origin request or non-browser client)
  if (!requestOrigin) {
    // For wildcard, return wildcard even without origin header
    if (corsConfig.origin === "*") {
      return { allowedOrigin: "*", allowCredentials: false };
    }
    // For other configurations, no CORS headers for missing origin
    return { allowedOrigin: null, allowCredentials: false };
  }

  // Wildcard origin
  if (corsConfig.origin === "*") {
    // Security: Cannot use credentials with wildcard
    if (corsConfig.credentials) {
      serverLogger.warn("[CORS] Cannot use credentials with wildcard origin - denying");
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Cannot use credentials with wildcard origin",
      };
    }
    return { allowedOrigin: "*", allowCredentials: false };
  }

  // Function-based validation
  if (typeof corsConfig.origin === "function") {
    try {
      const result = await corsConfig.origin(requestOrigin);

      // Function returned specific origin string
      if (typeof result === "string") {
        return {
          allowedOrigin: result,
          allowCredentials: corsConfig.credentials ?? false,
        };
      }

      // Function returned boolean
      const allowed = result === true;
      return {
        allowedOrigin: allowed ? requestOrigin : null,
        allowCredentials: allowed && (corsConfig.credentials ?? false),
        error: allowed ? undefined : "Origin rejected by validation function",
      };
    } catch (error) {
      serverLogger.error("[CORS] Origin validation function error", error);
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Origin validation error",
      };
    }
  }

  // Array of allowed origins
  if (Array.isArray(corsConfig.origin)) {
    const allowed = corsConfig.origin.includes(requestOrigin);
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin not in allowlist", {
        requestOrigin,
        allowedOrigins: corsConfig.origin,
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? undefined : "Origin not in allowlist",
    };
  }

  // Single origin string
  if (typeof corsConfig.origin === "string") {
    const allowed = corsConfig.origin === requestOrigin;
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin does not match", {
        requestOrigin,
        expectedOrigin: corsConfig.origin,
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? undefined : "Origin does not match",
    };
  }

  // Should never reach here
  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration",
  };
}

/**
 * Synchronous origin validation helper for environments that require
 * immediate header evaluation (e.g., fluent response builders).
 * Async origin validators are NOT supported here.
 */
export function validateOriginSync(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult {
  if (!config) {
    return { allowedOrigin: null, allowCredentials: false };
  }

  if (config === true) {
    const origin = requestOrigin || "*";
    return { allowedOrigin: origin, allowCredentials: false };
  }

  const corsConfig = config as CORSConfig;

  if (!corsConfig.origin) {
    return { allowedOrigin: null, allowCredentials: false };
  }

  if (!requestOrigin) {
    if (corsConfig.origin === "*") {
      return { allowedOrigin: "*", allowCredentials: false };
    }
    return { allowedOrigin: null, allowCredentials: false };
  }

  if (corsConfig.origin === "*") {
    if (corsConfig.credentials) {
      serverLogger.warn("[CORS] Cannot use credentials with wildcard origin - denying");
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Cannot use credentials with wildcard origin",
      };
    }
    return { allowedOrigin: "*", allowCredentials: false };
  }

  if (typeof corsConfig.origin === "function") {
    try {
      const result = corsConfig.origin(requestOrigin);
      if (result instanceof Promise) {
        serverLogger.warn(
          "[CORS] Async origin validators are not supported in synchronous contexts",
        );
        return {
          allowedOrigin: null,
          allowCredentials: false,
          error: "Async origin validators not supported",
        };
      }
      if (typeof result === "string") {
        return {
          allowedOrigin: result,
          allowCredentials: corsConfig.credentials ?? false,
        };
      }
      const allowed = result === true;
      return {
        allowedOrigin: allowed ? requestOrigin : null,
        allowCredentials: allowed && (corsConfig.credentials ?? false),
        error: allowed ? undefined : "Origin rejected by validation function",
      };
    } catch (error) {
      serverLogger.error("[CORS] Origin validation function error", error);
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Origin validation error",
      };
    }
  }

  if (Array.isArray(corsConfig.origin)) {
    const allowed = corsConfig.origin.includes(requestOrigin);
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin not in allowlist (sync)", {
        requestOrigin,
        allowedOrigins: corsConfig.origin,
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? undefined : "Origin not in allowlist",
    };
  }

  if (typeof corsConfig.origin === "string") {
    const allowed = corsConfig.origin === requestOrigin;
    if (!allowed) {
      recordCorsRejection();
      serverLogger.warn("[CORS] Origin does not match (sync)", {
        requestOrigin,
        expectedOrigin: corsConfig.origin,
      });
    }
    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && (corsConfig.credentials ?? false),
      error: allowed ? undefined : "Origin does not match",
    };
  }

  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration",
  };
}

/**
 * Validate CORS configuration for security issues
 * Prevents dangerous combinations
 *
 * @param config - CORS configuration to validate
 * @returns Validation result with error if invalid
 */
export function validateCORSConfig(config?: boolean | CORSConfig): {
  valid: boolean;
  error?: string;
} {
  if (!config || config === true) {
    return { valid: true };
  }

  const corsConfig = config as CORSConfig;

  // Cannot use credentials with wildcard origin
  if (corsConfig.origin === "*" && corsConfig.credentials) {
    return {
      valid: false,
      error: "Cannot use credentials with wildcard origin (*)",
    };
  }

  // Validate methods array if provided
  if (corsConfig.methods && corsConfig.methods.length === 0) {
    return {
      valid: false,
      error: "methods array cannot be empty",
    };
  }

  // Validate headers arrays
  if (corsConfig.allowedHeaders && corsConfig.allowedHeaders.length === 0) {
    return {
      valid: false,
      error: "allowedHeaders array cannot be empty",
    };
  }

  if (corsConfig.exposedHeaders && corsConfig.exposedHeaders.length === 0) {
    return {
      valid: false,
      error: "exposedHeaders array cannot be empty",
    };
  }

  // Validate maxAge is positive
  if (corsConfig.maxAge !== undefined && corsConfig.maxAge < 0) {
    return {
      valid: false,
      error: "maxAge must be a positive number",
    };
  }

  return { valid: true };
}
