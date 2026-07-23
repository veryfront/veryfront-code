import { logger as baseLogger, sanitizeUrlForSpan } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend } from "../types.ts";
import { getEnvValue } from "./helpers.ts";
import { buildBatchResults } from "../batch-results.ts";
import { REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getVerifiedCacheApiCredential } from "../verified-api-credential-context.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  expiresImmediately,
  resolveIntegerCacheTtlSeconds,
} from "./ttl.ts";

const logger = baseLogger.component("api-cache-backend");

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PROJECT_REF_UTF8_BYTES = 2_048;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;

type CacheRequestOptions = {
  failOnError?: boolean;
  expectJson?: boolean;
};

function normalizeApiBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("API cache base URL must be a non-blank trimmed URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("API cache base URL must be a valid absolute URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(
      "API cache base URL must use HTTP(S) and cannot contain credentials, query, or fragment",
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private readonly trustedProjectRef?: string;
  private circuitBreaker;

  constructor(
    options: {
      apiBaseUrl?: string;
      keyPrefix?: string;
      timeoutMs?: number;
      circuitBreakerName?: string;
      /** Project identity bound to process-level credentials at construction. */
      projectRef?: string;
    } = {},
  ) {
    this.apiBaseUrl = normalizeApiBaseUrl(
      options.apiBaseUrl ??
        getHostEnv("VERYFRONT_API_BASE_URL") ??
        getEnvValue("VERYFRONT_API_BASE_URL") ??
        "https://api.veryfront.com",
    );
    this.keyPrefix = options.keyPrefix ?? "";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError(
        `API cache timeoutMs must be a positive integer at most ${MAX_TIMEOUT_MS}`,
      );
    }
    this.timeoutMs = timeoutMs;
    if (
      options.projectRef !== undefined &&
      (options.projectRef.trim().length === 0 || options.projectRef.trim() !== options.projectRef ||
        new TextEncoder().encode(options.projectRef).byteLength > MAX_PROJECT_REF_UTF8_BYTES ||
        /\p{Cc}/u.test(options.projectRef))
    ) {
      throw new TypeError(
        "API cache projectRef must be a bounded non-blank trimmed string without control characters",
      );
    }
    this.trustedProjectRef = options.projectRef;

    const breakerName = options.circuitBreakerName ?? "api-cache";
    this.circuitBreaker = getCircuitBreaker(breakerName, {
      failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    });
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    options: CacheRequestOptions = {},
  ): Promise<unknown | null> {
    const verifiedCredential = getVerifiedCacheApiCredential();
    const reqCtx = getCurrentRequestContext();
    const requestCredential = reqCtx?.cacheApiCredential;
    const requestProjectRef = requestCredential?.projectId || requestCredential?.projectSlug;
    const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
    const hostProjectRef = this.trustedProjectRef || getHostEnv("VERYFRONT_PROJECT_ID") ||
      getHostEnv("VERYFRONT_PROJECT_SLUG");
    const envToken = getEnvValue("VERYFRONT_API_TOKEN");
    const envProjectRef = this.trustedProjectRef || getEnvValue("VERYFRONT_PROJECT_ID") ||
      getEnvValue("VERYFRONT_PROJECT_SLUG");

    // Select token and project as one capability. Never combine a broad host
    // credential with tenant identity from request headers/ALS.
    const boundCredential = verifiedCredential
      ? {
        token: verifiedCredential.token,
        projectRef: verifiedCredential.projectId || verifiedCredential.projectSlug,
        source: "verified-control-plane",
      }
      : requestCredential && requestProjectRef
      ? { token: requestCredential.token, projectRef: requestProjectRef, source: "request" }
      : hostToken && hostProjectRef
      ? { token: hostToken, projectRef: hostProjectRef, source: "host-env" }
      : envToken && envProjectRef
      ? { token: envToken, projectRef: envProjectRef, source: "env" }
      : null;
    const token = boundCredential?.token ?? null;
    const projectRef = boundCredential?.projectRef ?? null;
    const tokenSource = boundCredential?.source ?? "none";

    if (!token || !projectRef) {
      logger.debug("Missing auth or project context", {
        tokenSource,
        hasProjectRef: !!projectRef,
      });
      if (options.failOnError) {
        const missing = [
          !token ? "authentication token" : null,
          !projectRef ? "project context" : null,
        ].filter((part): part is string => part !== null);
        throw REQUEST_ERROR.create({
          detail: `Cache API request cannot proceed: missing ${missing.join(" and ")}`,
        });
      }
      return null;
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const encodedProjectRef = encodeURIComponent(projectRef);
        const url = `${this.apiBaseUrl}/projects/${encodedProjectRef}/cache${path}`;
        const spanUrl = sanitizeUrlForSpan(url);
        const cacheOperation = sanitizeUrlForSpan(path);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await withSpan(
            SpanNames.HTTP_CLIENT_FETCH,
            () =>
              fetch(url, {
                method,
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
              }),
            {
              "http.method": method,
              "http.url": spanUrl,
              "http.host": new URL(this.apiBaseUrl).host,
              "cache.operation": cacheOperation,
              "cache.project_slug": projectRef,
            },
          );

          if (!response.ok) {
            try {
              await response.body?.cancel();
            } catch (bodyError) {
              logger.debug("Failed to discard API error response body", {
                status: response.status,
                errorName: bodyError instanceof Error ? bodyError.name : typeof bodyError,
              });
            }
            throw REQUEST_ERROR.create({
              detail: `Cache API returned HTTP ${response.status}`,
            });
          }

          if (options.expectJson === false) {
            try {
              await response.body?.cancel();
            } catch (bodyError) {
              logger.debug("Failed to discard API mutation response body", {
                status: response.status,
                errorName: bodyError instanceof Error ? bodyError.name : typeof bodyError,
              });
            }
            return null;
          }

          return await response.json();
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.info("Circuit breaker open, failing fast", {
          path: sanitizeUrlForSpan(path),
          nextAttemptMs: error.nextAttemptMs,
        });
        if (options.failOnError) throw error;
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      logger.info(`Request ${isTimeout ? "timeout" : "error"}`, {
        path: sanitizeUrlForSpan(path),
        errorName: error instanceof Error ? error.name : typeof error,
        isTimeout,
        tokenSource,
        projectRef,
      });
      if (options.failOnError) throw error;
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    const result = await this.request(
      "GET",
      `/get?key=${encodeURIComponent(this.prefixKey(key))}`,
    );
    if (!isRecord(result)) return null;
    if (result.value === null || typeof result.value === "string") return result.value;

    logger.warn("Cache API returned an invalid get response", {
      valueType: Array.isArray(result.value) ? "array" : typeof result.value,
    });
    return null;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(keys.map((k) => [k, this.prefixKey(k)] as const));
    const response = await this.request(
      "POST",
      "/get-batch",
      { keys: keys.map((k) => prefixedByKey.get(k) as string) },
    );

    if (!isRecord(response) || !isRecord(response.values)) {
      logger.debug("Batch endpoint failed, falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys);
    }

    const values = response.values;
    const hasInvalidValue = [...prefixedByKey.values()].some((prefixedKey) => {
      const value = values[prefixedKey];
      return value !== undefined && value !== null && typeof value !== "string";
    });
    if (hasInvalidValue) {
      logger.warn("Cache API returned invalid batch values; falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys);
    }

    return buildBatchResults(keys, (key) => {
      const prefixedKey = prefixedByKey.get(key) as string;
      const value = values[prefixedKey];
      return typeof value === "string" ? value : null;
    });
  }

  private async getIndividually(keys: string[]): Promise<Map<string, string | null>> {
    const results = await Promise.all(keys.map(async (key) => [key, await this.get(key)] as const));
    return new Map(results);
  }

  async set(key: string, value: string, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS): Promise<void> {
    const ttl = resolveIntegerCacheTtlSeconds(ttlSeconds, DEFAULT_CACHE_TTL_SECONDS)!;
    if (expiresImmediately(ttl)) {
      await this.del(key);
      return;
    }

    await this.request("POST", "/set", {
      key: this.prefixKey(key),
      value,
      ttl,
    }, { expectJson: false, failOnError: true });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    // Validate the entire batch before authentication or network I/O. Collapse
    // duplicate keys to the final operation so mixed set/delete batches retain
    // deterministic last-write-wins semantics across separate API requests.
    const finalEntriesByKey = new Map<string, { key: string; value: string; ttl: number }>();
    for (const { key, value, ttl } of entries) {
      finalEntriesByKey.set(key, {
        key,
        value,
        ttl: resolveIntegerCacheTtlSeconds(ttl, DEFAULT_CACHE_TTL_SECONDS)!,
      });
    }

    const writes = [...finalEntriesByKey.values()]
      .filter(({ ttl }) => !expiresImmediately(ttl))
      .map(({ key, value, ttl }) => ({
        key: this.prefixKey(key),
        value,
        ttl,
      }));
    const deletes = [...finalEntriesByKey.values()]
      .filter(({ ttl }) => expiresImmediately(ttl))
      .map(({ key }) => key);

    if (writes.length > 0) {
      await this.request("POST", "/set-batch", { entries: writes }, {
        expectJson: false,
        failOnError: true,
      });
    }
    for (const key of deletes) await this.del(key);
  }

  async del(key: string): Promise<void> {
    await this.request("POST", "/del", { key: this.prefixKey(key) }, {
      failOnError: true,
      expectJson: false,
    });
  }

  async delByPattern(pattern: string): Promise<number> {
    const result = await this.request("POST", "/del-pattern", {
      pattern: this.prefixKey(pattern),
    }, { failOnError: true });
    if (result === null) return 0;
    if (
      !isRecord(result) ||
      !Number.isSafeInteger(result.deleted) ||
      (result.deleted as number) < 0
    ) {
      throw REQUEST_ERROR.create({ detail: "Cache API returned an invalid delete response" });
    }
    return result.deleted as number;
  }
}
