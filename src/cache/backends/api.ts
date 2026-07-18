import { logger as baseLogger, sanitizeUrlForSpan } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { tryGetCacheKeyContext } from "../cache-key-builder.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend } from "../types.ts";
import { getEnvValue } from "./helpers.ts";
import { buildBatchResults } from "../batch-results.ts";
import { REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getVerifiedCacheApiCredential } from "../verified-api-credential-context.ts";

const logger = baseLogger.component("api-cache-backend");

const DEFAULT_TIMEOUT_MS = 10_000;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const ERROR_BODY_MAX_LENGTH = 500;

type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

let warnedMissingAdapterContract = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getCurrentRequestContext(): CacheRequestContext | null {
  const adapter = (globalThis as Record<string, unknown>).__vf_multi_project_adapter;

  // The adapter is installed dynamically, so validate its shape instead of an
  // unchecked cast. If it exists but no longer exposes getCurrentRequestContext
  // (e.g., renamed/moved), the API cache would otherwise silently fail to
  // authenticate forever with only a debug log — so warn once, loudly.
  if (
    adapter !== undefined &&
    !(isRecord(adapter) && typeof adapter.getCurrentRequestContext === "function")
  ) {
    if (!warnedMissingAdapterContract) {
      warnedMissingAdapterContract = true;
      logger.warn("Multi-project adapter present but missing getCurrentRequestContext()");
    }
    return null;
  }

  if (!isRecord(adapter) || typeof adapter.getCurrentRequestContext !== "function") {
    return null;
  }

  const ctx = (adapter.getCurrentRequestContext as () => unknown)();
  return isRecord(ctx) ? (ctx as CacheRequestContext) : null;
}

export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private circuitBreaker;

  constructor(
    options: {
      apiBaseUrl?: string;
      keyPrefix?: string;
      timeoutMs?: number;
      circuitBreakerName?: string;
    } = {},
  ) {
    this.apiBaseUrl = options.apiBaseUrl ??
      getHostEnv("VERYFRONT_API_BASE_URL") ??
      getEnvValue("VERYFRONT_API_BASE_URL") ??
      "https://api.veryfront.com";
    this.keyPrefix = options.keyPrefix ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T | null> {
    const reqCtx = getCurrentRequestContext();
    const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
    const envToken = getEnvValue("VERYFRONT_API_TOKEN");
    const verifiedCredential = getVerifiedCacheApiCredential();
    const verifiedRequestToken = verifiedCredential?.token;
    // The private verified-request context cannot be changed through the
    // globally exposed filesystem request context.
    const token = verifiedRequestToken || hostToken || reqCtx?.token || envToken || null;
    const tokenSource = verifiedRequestToken
      ? "verified-control-plane"
      : hostToken
      ? "host-env"
      : reqCtx?.token
      ? "request"
      : envToken
      ? "env"
      : "none";
    const projectRef = verifiedCredential?.projectId || verifiedCredential?.projectSlug ||
      reqCtx?.projectId || reqCtx?.projectSlug ||
      tryGetCacheKeyContext()?.projectId || null;

    if (!token || !projectRef) {
      logger.debug("Missing auth or project context", {
        tokenSource,
        hasProjectRef: !!projectRef,
      });
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
            let responseBody = "";
            try {
              responseBody = await response.text();
            } catch (bodyError) {
              logger.error("Failed to read API error response body", {
                status: response.status,
                error: bodyError instanceof Error ? bodyError.message : String(bodyError),
              });
            }
            throw REQUEST_ERROR.create({
              detail: `HTTP ${response.status}: ${responseBody.slice(0, ERROR_BODY_MAX_LENGTH)}`,
            });
          }

          return (await response.json()) as T;
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
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.info(`Request ${isTimeout ? "timeout" : "error"}`, {
        path: sanitizeUrlForSpan(path),
        error: errorMsg,
        isTimeout,
        tokenSource,
        projectRef,
      });
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    const result = await this.request<{ value: string | null }>(
      "GET",
      `/get?key=${encodeURIComponent(this.prefixKey(key))}`,
    );
    return result?.value ?? null;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(keys.map((k) => [k, this.prefixKey(k)] as const));
    const response = await this.request<{ values: Record<string, string | null> }>(
      "POST",
      "/get-batch",
      { keys: keys.map((k) => prefixedByKey.get(k) as string) },
    );

    if (!response?.values) {
      logger.debug("Batch endpoint failed, falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys);
    }

    return buildBatchResults(keys, (key) => {
      const prefixedKey = prefixedByKey.get(key) as string;
      return response.values[prefixedKey] ?? null;
    });
  }

  private async getIndividually(keys: string[]): Promise<Map<string, string | null>> {
    const results = await Promise.all(keys.map(async (key) => [key, await this.get(key)] as const));
    return new Map(results);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    await this.request("POST", "/set", {
      key: this.prefixKey(key),
      value,
      ttl: ttlSeconds,
    });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const prefixedEntries = entries.map(({ key, value, ttl }) => ({
      key: this.prefixKey(key),
      value,
      ttl,
    }));

    await this.request("POST", "/set-batch", { entries: prefixedEntries });
  }

  async del(key: string): Promise<void> {
    await this.request("POST", "/del", { key: this.prefixKey(key) });
  }

  async delByPattern(pattern: string): Promise<number> {
    const result = await this.request<{ deleted: number }>("POST", "/del-pattern", {
      pattern: this.prefixKey(pattern),
    });
    return result?.deleted ?? 0;
  }
}
