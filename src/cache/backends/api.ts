import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { tryGetCacheKeyContext } from "../cache-key-builder.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend } from "../types.ts";
import { getEnvValue } from "./helpers.ts";

type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

function getCurrentRequestContext(): CacheRequestContext | null {
  const mod = globalThis.__vf_multi_project_adapter;
  return (mod?.getCurrentRequestContext?.() as CacheRequestContext | undefined) ?? null;
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
      getEnvValue("VERYFRONT_API_BASE_URL") ??
      "https://api.veryfront.com";
    this.keyPrefix = options.keyPrefix ?? "";
    this.timeoutMs = options.timeoutMs ?? 10000;

    const breakerName = options.circuitBreakerName ?? "api-cache";
    this.circuitBreaker = getCircuitBreaker(breakerName, {
      failureThreshold: 10,
      resetTimeoutMs: 15000,
      successThreshold: 2,
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
    const envToken = getEnvValue("VERYFRONT_API_TOKEN");
    // Prefer request context token (from proxy) - this is how production works
    const token = reqCtx?.token || envToken || null;
    const tokenSource = reqCtx?.token ? "request" : envToken ? "env" : "none";
    const projectRef = reqCtx?.projectId || reqCtx?.projectSlug ||
      tryGetCacheKeyContext()?.projectId || null;

    if (!token || !projectRef) {
      logger.debug("[ApiCacheBackend] Missing auth or project context", {
        tokenSource,
        hasProjectRef: !!projectRef,
      });
      return null;
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectRef}/cache${path}`;
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
              "http.url": url,
              "http.host": new URL(this.apiBaseUrl).host,
              "cache.operation": path,
              "cache.project_slug": projectRef,
            },
          );

          if (!response.ok) {
            let responseBody = "";
            try {
              responseBody = await response.text();
            } catch {
              // ignore body read errors
            }
            throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
          }

          return (await response.json()) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.info("[ApiCacheBackend] Circuit breaker open, failing fast", {
          path,
          nextAttemptMs: error.nextAttemptMs,
        });
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.info(`[ApiCacheBackend] Request ${isTimeout ? "timeout" : "error"}`, {
        path,
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
    const results = new Map<string, string | null>();
    if (keys.length === 0) return results;

    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const response = await this.request<{ values: Record<string, string | null> }>(
      "POST",
      "/get-batch",
      { keys: prefixedKeys },
    );

    if (!response?.values) {
      logger.debug("[ApiCacheBackend] Batch endpoint failed, falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys);
    }

    for (let i = 0; i < keys.length; i++) {
      const originalKey = keys[i] as string;
      const prefixedKey = prefixedKeys[i] as string;
      results.set(originalKey, response.values[prefixedKey] ?? null);
    }

    return results;
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
