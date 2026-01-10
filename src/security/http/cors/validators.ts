/**
 * CORS Validators
 * Origin validation logic for CORS handling
 *
 * @module core/cors/validators
 */

import type { CORSConfig, CORSValidationResult } from "./types.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
import { recordCorsRejection } from "@veryfront/observability";

const NO_CORS_RESULT: CORSValidationResult = { allowedOrigin: null, allowCredentials: false };

/**
 * Handle early validation checks common to sync and async paths.
 * Returns a result if validation is complete, or null to continue.
 */
function validateEarly(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult | null {
  if (!config) {
    return NO_CORS_RESULT;
  }

  if (config === true) {
    return { allowedOrigin: requestOrigin || "*", allowCredentials: false };
  }

  const corsConfig = config as CORSConfig;

  if (!corsConfig.origin) {
    return NO_CORS_RESULT;
  }

  if (!requestOrigin) {
    if (corsConfig.origin === "*") {
      return { allowedOrigin: "*", allowCredentials: false };
    }
    return NO_CORS_RESULT;
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

  return null;
}

/**
 * Validate array or string origin configuration.
 */
function validateStaticOrigin(
  requestOrigin: string,
  corsConfig: CORSConfig,
): CORSValidationResult {
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

  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration",
  };
}

/**
 * Process function validation result into CORSValidationResult.
 */
function processFunctionResult(
  result: string | boolean,
  requestOrigin: string,
  credentials: boolean,
): CORSValidationResult {
  if (typeof result === "string") {
    return { allowedOrigin: result, allowCredentials: credentials };
  }
  const allowed = result === true;
  return {
    allowedOrigin: allowed ? requestOrigin : null,
    allowCredentials: allowed && credentials,
    error: allowed ? undefined : "Origin rejected by validation function",
  };
}

/**
 * Validate origin against CORS configuration
 * Returns the allowed origin or null if not allowed
 *
 * @param requestOrigin - The origin from the request header
 * @param config - CORS configuration
 * @returns Validation result with allowed origin and credentials
 */
export async function validateOrigin(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): Promise<CORSValidationResult> {
  const earlyResult = validateEarly(requestOrigin, config);
  if (earlyResult) return earlyResult;

  const corsConfig = config as CORSConfig;

  if (typeof corsConfig.origin === "function") {
    try {
      const result = await corsConfig.origin(requestOrigin!);
      return processFunctionResult(result, requestOrigin!, corsConfig.credentials ?? false);
    } catch (error) {
      serverLogger.error("[CORS] Origin validation function error", error);
      return { allowedOrigin: null, allowCredentials: false, error: "Origin validation error" };
    }
  }

  return validateStaticOrigin(requestOrigin!, corsConfig);
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
  const earlyResult = validateEarly(requestOrigin, config);
  if (earlyResult) return earlyResult;

  const corsConfig = config as CORSConfig;

  if (typeof corsConfig.origin === "function") {
    try {
      const result = corsConfig.origin(requestOrigin!);
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
      return processFunctionResult(result, requestOrigin!, corsConfig.credentials ?? false);
    } catch (error) {
      serverLogger.error("[CORS] Origin validation function error", error);
      return { allowedOrigin: null, allowCredentials: false, error: "Origin validation error" };
    }
  }

  return validateStaticOrigin(requestOrigin!, corsConfig);
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
