import type { CORSConfig, CORSValidationResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { recordCorsRejection } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isBoundedCorsOrigin,
  isBoundedCorsOriginList,
  isBoundedCorsTokenList,
  isValidCorsMaxAge,
  MAX_CORS_ORIGIN_COUNT,
  MAX_CORS_TOKEN_COUNT,
} from "#veryfront/utils/cors-policy-limits.ts";

const logger = serverLogger.component("cors");

const CORS_CONFIG_KEYS = new Set([
  "origin",
  "credentials",
  "methods",
  "allowedHeaders",
  "exposedHeaders",
  "maxAge",
]);

export type NormalizedCORSConfig = boolean | CORSConfig;

export type CORSConfigNormalizationResult =
  | { valid: true; config: NormalizedCORSConfig }
  | { valid: false; error: string };

function corsResult(
  allowedOrigin: string | null,
  allowCredentials: boolean,
  error?: string,
): CORSValidationResult {
  const result: CORSValidationResult = { allowedOrigin, allowCredentials };
  if (error !== undefined) result.error = error;
  return Object.freeze(result);
}

function denyCors(error?: string): CORSValidationResult {
  return corsResult(null, false, error);
}

function invalidConfig(error: string): CORSConfigNormalizationResult {
  return { valid: false, error };
}

/**
 * Snapshot a short array without invoking iterators, indexed accessors, or
 * proxy `get` traps. Every proxy-sensitive reflection operation is guarded so
 * revoked and otherwise hostile proxies become a deterministic invalid value.
 */
export function snapshotCORSArray(
  value: unknown,
  maxLength: number,
): unknown[] | null {
  let array: boolean;
  try {
    array = Array.isArray(value);
  } catch {
    return null;
  }
  if (!array) return null;

  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maxLength
    ) {
      return null;
    }

    const snapshot = new Array<unknown>(length);
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      snapshot[index] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotTokenList(
  name: "methods" | "allowedHeaders" | "exposedHeaders",
  value: unknown,
): { valid: true; value: string[] | undefined } | { valid: false; error: string } {
  if (value === undefined) return { valid: true, value: undefined };

  const snapshot = snapshotCORSArray(value, MAX_CORS_TOKEN_COUNT);
  if (!snapshot) return { valid: false, error: `${name} must be an array` };
  if (snapshot.length === 0) {
    return { valid: false, error: `${name} array cannot be empty` };
  }
  if (!isBoundedCorsTokenList(snapshot)) {
    const description = name === "methods" ? "HTTP method tokens" : "HTTP header names";
    return {
      valid: false,
      error: `${name} must contain bounded valid ${description}`,
    };
  }

  const normalized = snapshot as string[];
  Object.freeze(normalized);
  return { valid: true, value: normalized };
}

/**
 * Snapshot and validate an untrusted runtime CORS policy.
 *
 * The schema protects configuration loaded through the normal config path, but
 * public response helpers can be called with arbitrary JavaScript values. This
 * is the single runtime contract used by those boundaries.
 */
export function normalizeCORSConfig(config: unknown): CORSConfigNormalizationResult {
  if (config === undefined || config === false) {
    return { valid: true, config: false };
  }
  if (config === true) {
    return { valid: true, config: true };
  }
  if (typeof config !== "object" || config === null) {
    return invalidConfig("configuration must be a boolean or CORS options object");
  }

  let configIsArray: boolean;
  let keys: (string | symbol)[];
  const values: Partial<Record<keyof CORSConfig, unknown>> = {};
  try {
    configIsArray = Array.isArray(config);
    if (configIsArray) {
      return invalidConfig("configuration must be a boolean or CORS options object");
    }
    const prototype = Object.getPrototypeOf(config);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidConfig("configuration must be a plain options object");
    }
    keys = Reflect.ownKeys(config);

    for (const key of keys) {
      if (typeof key !== "string" || !CORS_CONFIG_KEYS.has(key)) {
        return invalidConfig("configuration contains unknown options");
      }
      const descriptor = Object.getOwnPropertyDescriptor(config, key);
      if (!descriptor || !("value" in descriptor)) {
        return invalidConfig("configuration options must be own data properties");
      }
      values[key as keyof CORSConfig] = descriptor.value;
    }
  } catch {
    return invalidConfig("configuration could not be inspected safely");
  }

  const valueOf = (key: keyof CORSConfig): unknown => values[key];
  const normalized: CORSConfig = {};

  const origin = valueOf("origin");
  if (origin !== undefined) {
    if (typeof origin === "string") {
      if (!isBoundedCorsOrigin(origin)) {
        return invalidConfig(
          "origin must be a bounded header-safe string, string array, or validator",
        );
      }
      normalized.origin = origin;
    } else if (typeof origin === "function") {
      normalized.origin = origin as NonNullable<CORSConfig["origin"]>;
    } else {
      const snapshot = snapshotCORSArray(origin, MAX_CORS_ORIGIN_COUNT);
      if (!snapshot || !isBoundedCorsOriginList(snapshot)) {
        return invalidConfig(
          "origin must be a bounded header-safe string, string array, or validator",
        );
      }
      const origins = snapshot as string[];
      Object.freeze(origins);
      normalized.origin = origins;
    }
  }

  const credentials = valueOf("credentials");
  if (credentials !== undefined) {
    if (typeof credentials !== "boolean") {
      return invalidConfig("credentials must be a boolean");
    }
    normalized.credentials = credentials;
  }

  for (const name of ["methods", "allowedHeaders", "exposedHeaders"] as const) {
    const result = snapshotTokenList(name, valueOf(name));
    if (!result.valid) return result;
    if (result.value !== undefined) normalized[name] = result.value;
  }

  const maxAge = valueOf("maxAge");
  if (maxAge !== undefined) {
    if (!isValidCorsMaxAge(maxAge)) {
      return invalidConfig("maxAge must be a non-negative safe integer");
    }
    normalized.maxAge = maxAge;
  }

  if (normalized.origin === "*" && normalized.credentials === true) {
    return invalidConfig("Cannot use credentials with wildcard origin");
  }

  Object.freeze(normalized);
  return { valid: true, config: normalized };
}

function validateEarly(
  requestOrigin: unknown,
  config: NormalizedCORSConfig,
): CORSValidationResult | null {
  if (config === false) return denyCors();

  if (requestOrigin !== null && !isBoundedCorsOrigin(requestOrigin)) {
    return denyCors("Invalid or oversized request origin");
  }

  if (config === true) {
    return corsResult(requestOrigin ?? "*", false);
  }

  if (config.origin === undefined) return denyCors();

  if (requestOrigin === null) {
    return config.origin === "*" ? corsResult("*", false) : denyCors();
  }

  if (config.origin !== "*") return null;

  if (config.credentials) {
    logger.warn("Cannot use credentials with wildcard origin - denying");
    return denyCors("Cannot use credentials with wildcard origin");
  }

  return corsResult("*", false);
}

function validateStaticOrigin(
  requestOrigin: string,
  corsConfig: CORSConfig,
): CORSValidationResult {
  const credentials = corsConfig.credentials ?? false;
  const { origin } = corsConfig;

  let originIsArray = false;
  try {
    originIsArray = Array.isArray(origin);
  } catch {
    return denyCors("Invalid origin configuration");
  }

  if (originIsArray) {
    const origins = origin as string[];
    const allowed = origins.includes(requestOrigin);

    if (!allowed) {
      recordCorsRejection();
      logger.debug("Origin not in allowlist", { requestOrigin });
    }

    return corsResult(
      allowed ? requestOrigin : null,
      allowed && credentials,
      allowed ? undefined : "Origin not in allowlist",
    );
  }

  if (typeof origin === "string") {
    const allowed = origin === requestOrigin;

    if (!allowed) {
      recordCorsRejection();
      logger.debug("Origin does not match", { requestOrigin, expectedOrigin: origin });
    }

    return corsResult(
      allowed ? requestOrigin : null,
      allowed && credentials,
      allowed ? undefined : "Origin does not match",
    );
  }

  return denyCors("Invalid origin configuration");
}

function processFunctionResult(
  result: unknown,
  requestOrigin: string,
  credentials: boolean,
): CORSValidationResult {
  if (typeof result === "string") {
    if (!isBoundedCorsOrigin(result) || (result === "*" && credentials)) {
      return denyCors("Origin validator returned an invalid or oversized origin");
    }
    return corsResult(result, credentials && result !== "*");
  }

  if (typeof result !== "boolean") {
    return denyCors("Origin validator returned an invalid result");
  }

  return corsResult(
    result ? requestOrigin : null,
    result && credentials,
    result ? undefined : "Origin rejected by validation function",
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

export async function validateNormalizedOrigin(
  requestOrigin: unknown,
  config: NormalizedCORSConfig,
): Promise<CORSValidationResult> {
  const earlyResult = validateEarly(requestOrigin, config);
  if (earlyResult) return earlyResult;

  const corsConfig = config as CORSConfig;
  const origin = requestOrigin as string;
  const credentials = corsConfig.credentials ?? false;

  if (typeof corsConfig.origin === "function") {
    try {
      const result = await corsConfig.origin(origin);
      return processFunctionResult(result, origin, credentials);
    } catch (error) {
      logger.error("Origin validation function error", error);
      return denyCors("Origin validation error");
    }
  }

  return validateStaticOrigin(origin, corsConfig);
}

export function validateNormalizedOriginSync(
  requestOrigin: unknown,
  config: NormalizedCORSConfig,
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
    if (isPromiseLike(result)) {
      // Synchronous APIs cannot use the value, but they still own the
      // validator invocation. Observe a future rejection immediately so the
      // fail-closed return cannot be followed by an unhandled rejection.
      void Promise.resolve(result).catch(() => undefined);
      logger.warn("Async origin validators are not supported in synchronous contexts");
      return denyCors("Async origin validators not supported");
    }
    return processFunctionResult(result, origin, credentials);
  } catch (error) {
    logger.error("Origin validation function error", error);
    return denyCors("Origin validation error");
  }
}

export function corsOriginForTelemetry(requestOrigin: unknown): string {
  if (requestOrigin === null) return "null";
  return isBoundedCorsOrigin(requestOrigin) ? requestOrigin : "invalid";
}

/** Validate origin against CORS configuration. */
export function validateOrigin(
  requestOrigin: unknown,
  config?: boolean | CORSConfig,
): Promise<CORSValidationResult> {
  return withSpan(
    "security.cors.validateOrigin",
    async (): Promise<CORSValidationResult> => {
      const normalized = normalizeCORSConfig(config);
      if (!normalized.valid) return denyCors(normalized.error);
      return await validateNormalizedOrigin(requestOrigin, normalized.config);
    },
    { "cors.origin": corsOriginForTelemetry(requestOrigin) },
  );
}

/**
 * Synchronous origin validation.
 *
 * The broad CORSConfig parameter is retained for source compatibility.
 * Promise-returning validators are detected and denied at runtime.
 */
export function validateOriginSync(
  requestOrigin: unknown,
  config?: boolean | CORSConfig,
): CORSValidationResult {
  const normalized = normalizeCORSConfig(config);
  if (!normalized.valid) return denyCors(normalized.error);
  return validateNormalizedOriginSync(requestOrigin, normalized.config);
}

/** Validate CORS configuration for security issues. */
export function validateCORSConfig(
  config?: boolean | CORSConfig,
): { valid: boolean; error?: string } {
  const normalized = normalizeCORSConfig(config);
  if (normalized.valid) return { valid: true };
  return {
    valid: false,
    error: normalized.error === "Cannot use credentials with wildcard origin"
      ? "Cannot use credentials with wildcard origin (*)"
      : normalized.error,
  };
}
