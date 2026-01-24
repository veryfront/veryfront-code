import type { CORSConfig, CORSValidationResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { recordCorsRejection } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const NO_CORS_RESULT: CORSValidationResult = { allowedOrigin: null, allowCredentials: false };

/** Early validation checks common to sync and async paths */
function validateEarly(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult | null {
  if (!config) return NO_CORS_RESULT;

  if (config === true) {
    return { allowedOrigin: requestOrigin ?? "*", allowCredentials: false };
  }

  if (!config.origin) return NO_CORS_RESULT;

  if (!requestOrigin) {
    return config.origin === "*" ? { allowedOrigin: "*", allowCredentials: false } : NO_CORS_RESULT;
  }

  if (config.origin !== "*") return null;

  if (config.credentials) {
    serverLogger.warn("[CORS] Cannot use credentials with wildcard origin - denying");
    return {
      allowedOrigin: null,
      allowCredentials: false,
      error: "Cannot use credentials with wildcard origin",
    };
  }

  return { allowedOrigin: "*", allowCredentials: false };
}

function validateStaticOrigin(requestOrigin: string, corsConfig: CORSConfig): CORSValidationResult {
  const credentials = corsConfig.credentials ?? false;

  if (Array.isArray(corsConfig.origin)) {
    const allowed = corsConfig.origin.includes(requestOrigin);

    if (!allowed) {
      recordCorsRejection();
      // Log at debug level - this is expected in dev when CORS config doesn't match request origin
      serverLogger.debug("[CORS] Origin not in allowlist", { requestOrigin });
    }

    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && credentials,
      error: allowed ? undefined : "Origin not in allowlist",
    };
  }

  if (typeof corsConfig.origin === "string") {
    const allowed = corsConfig.origin === requestOrigin;

    if (!allowed) {
      recordCorsRejection();
      // Log at debug level - this is expected in dev when CORS config doesn't match request origin
      serverLogger.debug("[CORS] Origin does not match", {
        requestOrigin,
        expectedOrigin: corsConfig.origin,
      });
    }

    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && credentials,
      error: allowed ? undefined : "Origin does not match",
    };
  }

  return {
    allowedOrigin: null,
    allowCredentials: false,
    error: "Invalid origin configuration",
  };
}

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

/** Validate origin against CORS configuration */
export function validateOrigin(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): Promise<CORSValidationResult> {
  return withSpan(
    "security.cors.validateOrigin",
    async () => {
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
    },
    { "cors.origin": requestOrigin ?? "null" },
  );
}

/** Synchronous origin validation (async validators not supported) */
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

/** Validate CORS configuration for security issues */
export function validateCORSConfig(
  config?: boolean | CORSConfig,
): { valid: boolean; error?: string } {
  if (!config || config === true) return { valid: true };

  // Cannot use credentials with wildcard origin
  if (config.origin === "*" && config.credentials) {
    return { valid: false, error: "Cannot use credentials with wildcard origin (*)" };
  }

  // Validate methods array if provided
  if (config.methods?.length === 0) {
    return { valid: false, error: "methods array cannot be empty" };
  }

  // Validate headers arrays
  if (config.allowedHeaders?.length === 0) {
    return { valid: false, error: "allowedHeaders array cannot be empty" };
  }

  if (config.exposedHeaders?.length === 0) {
    return { valid: false, error: "exposedHeaders array cannot be empty" };
  }

  // Validate maxAge is positive
  if (config.maxAge !== undefined && config.maxAge < 0) {
    return { valid: false, error: "maxAge must be a positive number" };
  }

  return { valid: true };
}
