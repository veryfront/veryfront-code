import type { CORSConfig, CORSValidationResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { recordCorsRejection } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = serverLogger.component("cors");

const NO_CORS_RESULT: CORSValidationResult = { allowedOrigin: null, allowCredentials: false };
const HTTP_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isSafeHeaderValue(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function validateTokenArray(
  value: unknown,
  name: "methods" | "allowedHeaders" | "exposedHeaders",
): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `${name} must be an array`;
  if (value.length === 0) return `${name} array cannot be empty`;
  if (value.some((entry) => typeof entry !== "string" || !HTTP_TOKEN_RE.test(entry))) {
    return name === "methods"
      ? "methods entries must be valid HTTP tokens"
      : `${name} entries must be valid header names`;
  }
  return undefined;
}

/** Early validation checks common to sync and async paths */
function validateEarly(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult | null {
  if (!config) return NO_CORS_RESULT;

  if (config !== true && config.origin === "*" && config.credentials) {
    logger.warn("Cannot use credentials with wildcard origin - denying");
    return {
      allowedOrigin: null,
      allowCredentials: false,
      error: "Cannot use credentials with wildcard origin",
    };
  }

  const configValidation = validateCORSConfig(config);
  if (!configValidation.valid) {
    return {
      allowedOrigin: null,
      allowCredentials: false,
      error: configValidation.error ?? "Invalid CORS configuration",
    };
  }

  if (config === true) {
    return { allowedOrigin: requestOrigin ?? "*", allowCredentials: false };
  }

  if (!config.origin) return NO_CORS_RESULT;

  if (!requestOrigin) {
    return config.origin === "*" ? { allowedOrigin: "*", allowCredentials: false } : NO_CORS_RESULT;
  }

  if (config.origin !== "*") return null;

  return { allowedOrigin: "*", allowCredentials: false };
}

function validateStaticOrigin(requestOrigin: string, corsConfig: CORSConfig): CORSValidationResult {
  const credentials = corsConfig.credentials ?? false;
  const { origin } = corsConfig;

  if (Array.isArray(origin)) {
    const allowed = origin.includes(requestOrigin);

    if (!allowed) {
      recordCorsRejection();
      logger.debug("Origin not in allowlist");
    }

    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && credentials,
      error: allowed ? undefined : "Origin not in allowlist",
    };
  }

  if (typeof origin === "string") {
    const allowed = origin === requestOrigin;

    if (!allowed) {
      recordCorsRejection();
      logger.debug("Origin does not match configured origin");
    }

    return {
      allowedOrigin: allowed ? requestOrigin : null,
      allowCredentials: allowed && credentials,
      error: allowed ? undefined : "Origin does not match",
    };
  }

  return { allowedOrigin: null, allowCredentials: false, error: "Invalid origin configuration" };
}

function processFunctionResult(
  result: string | boolean,
  requestOrigin: string,
  credentials: boolean,
): CORSValidationResult {
  if (typeof result === "string") {
    if (!isSafeHeaderValue(result) || (result === "*" && credentials)) {
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Origin validation function returned an invalid origin",
      };
    }
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
    async (): Promise<CORSValidationResult> => {
      const earlyResult = validateEarly(requestOrigin, config);
      if (earlyResult) return earlyResult;

      const corsConfig = config as CORSConfig;
      const origin = requestOrigin as string;
      const credentials = corsConfig.credentials ?? false;

      if (typeof corsConfig.origin === "function") {
        try {
          const result = await corsConfig.origin(origin);
          return processFunctionResult(result, origin, credentials);
        } catch {
          logger.error("Origin validation function failed");
          return { allowedOrigin: null, allowCredentials: false, error: "Origin validation error" };
        }
      }

      return validateStaticOrigin(origin, corsConfig);
    },
    {},
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
  const origin = requestOrigin as string;
  const credentials = corsConfig.credentials ?? false;

  if (typeof corsConfig.origin !== "function") {
    return validateStaticOrigin(origin, corsConfig);
  }

  try {
    const result = corsConfig.origin(origin);

    if (result instanceof Promise) {
      logger.warn("Async origin validators are not supported in synchronous contexts");
      return {
        allowedOrigin: null,
        allowCredentials: false,
        error: "Async origin validators not supported",
      };
    }

    return processFunctionResult(result, origin, credentials);
  } catch {
    logger.error("Origin validation function failed");
    return { allowedOrigin: null, allowCredentials: false, error: "Origin validation error" };
  }
}

/** Validate CORS configuration for security issues */
export function validateCORSConfig(
  config?: boolean | CORSConfig,
): { valid: boolean; error?: string } {
  if (!config || config === true) return { valid: true };

  if (typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, error: "CORS config must be an object or boolean" };
  }

  if (config.credentials !== undefined && typeof config.credentials !== "boolean") {
    return { valid: false, error: "credentials must be a boolean" };
  }

  if (config.origin !== undefined && typeof config.origin !== "function") {
    const origins = Array.isArray(config.origin) ? config.origin : [config.origin];
    if (origins.some((origin) => typeof origin !== "string" || !isSafeHeaderValue(origin))) {
      return { valid: false, error: "origin entries must be non-empty strings" };
    }
  }

  if (config.origin === "*" && config.credentials) {
    return { valid: false, error: "Cannot use credentials with wildcard origin (*)" };
  }

  for (const name of ["methods", "allowedHeaders", "exposedHeaders"] as const) {
    const error = validateTokenArray((config as Record<string, unknown>)[name], name);
    if (error) return { valid: false, error };
  }

  if (
    config.maxAge !== undefined &&
    (!Number.isSafeInteger(config.maxAge) || config.maxAge < 0)
  ) {
    return { valid: false, error: "maxAge must be a non-negative safe integer" };
  }

  return { valid: true };
}
