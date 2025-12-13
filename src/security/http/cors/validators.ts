
import type { CORSConfig, CORSValidationResult } from "./types.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
import { recordCorsRejection } from "@veryfront/observability";

/**
 * Core origin validation logic shared between sync and async versions.
 * Returns either a final result or indicates that function validation is needed.
 */
function validateOriginCore(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult | { needsFunctionValidation: true; corsConfig: CORSConfig } {
  if (!config) {
    return { allowedOrigin: null, allowCredentials: false };
  }

  if (config === true) {
    const origin = requestOrigin || "*";
    return { allowedOrigin: origin, allowCredentials: false };
  }

  const corsConfig = config;

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
    return { needsFunctionValidation: true, corsConfig };
  }

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
 * Helper to check if the result requires function validation
 */
function needsFunctionValidation(
  result: CORSValidationResult | { needsFunctionValidation: true; corsConfig: CORSConfig },
): result is { needsFunctionValidation: true; corsConfig: CORSConfig } {
  return "needsFunctionValidation" in result && result.needsFunctionValidation === true;
}

/**
 * Process the result of calling the origin validation function
 */
function processOriginFunctionResult(
  result: boolean | string,
  requestOrigin: string,
  credentials: boolean,
): CORSValidationResult {
  if (typeof result === "string") {
    return {
      allowedOrigin: result,
      allowCredentials: credentials,
    };
  }

  const allowed = result === true;
  return {
    allowedOrigin: allowed ? requestOrigin : null,
    allowCredentials: allowed && credentials,
    error: allowed ? undefined : "Origin rejected by validation function",
  };
}

export async function validateOrigin(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): Promise<CORSValidationResult> {
  const coreResult = validateOriginCore(requestOrigin, config);

  if (!needsFunctionValidation(coreResult)) {
    return coreResult;
  }

  const { corsConfig } = coreResult;
  const originFn = corsConfig.origin as (origin: string) => boolean | string | Promise<boolean | string>;

  try {
    const result = await originFn(requestOrigin!);
    return processOriginFunctionResult(result, requestOrigin!, corsConfig.credentials ?? false);
  } catch (error) {
    serverLogger.error("[CORS] Origin validation function error", error);
    return {
      allowedOrigin: null,
      allowCredentials: false,
      error: "Origin validation error",
    };
  }
}

export function validateOriginSync(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult {
  const coreResult = validateOriginCore(requestOrigin, config);

  if (!needsFunctionValidation(coreResult)) {
    return coreResult;
  }

  const { corsConfig } = coreResult;
  const originFn = corsConfig.origin as (origin: string) => boolean | string | Promise<boolean | string>;

  try {
    const result = originFn(requestOrigin!);
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
    return processOriginFunctionResult(result, requestOrigin!, corsConfig.credentials ?? false);
  } catch (error) {
    serverLogger.error("[CORS] Origin validation function error", error);
    return {
      allowedOrigin: null,
      allowCredentials: false,
      error: "Origin validation error",
    };
  }
}

export function validateCORSConfig(config?: boolean | CORSConfig): {
  valid: boolean;
  error?: string;
} {
  if (!config || config === true) {
    return { valid: true };
  }

  const corsConfig = config as CORSConfig;

  if (corsConfig.origin === "*" && corsConfig.credentials) {
    return {
      valid: false,
      error: "Cannot use credentials with wildcard origin (*)",
    };
  }

  if (corsConfig.methods && corsConfig.methods.length === 0) {
    return {
      valid: false,
      error: "methods array cannot be empty",
    };
  }

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

  if (corsConfig.maxAge !== undefined && corsConfig.maxAge < 0) {
    return {
      valid: false,
      error: "maxAge must be a positive number",
    };
  }

  return { valid: true };
}
