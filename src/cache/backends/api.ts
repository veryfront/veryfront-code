import { logger as baseLogger, sanitizeUrlForSpan } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { tryGetCacheKeyContext } from "../cache-key-builder.ts";
import { isValidCachePattern, sanitizeCacheKey } from "../keys/index.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend } from "../types.ts";
import { getEnvValue } from "./helpers.ts";
import { buildBatchResults } from "../batch-results.ts";
import { REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import { getVerifiedCacheApiCredential } from "../verified-api-credential-context.ts";
import {
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
  CacheValueTooLargeError,
} from "../bounded-read.ts";
import {
  JsonStringValueTooLargeError,
  maximumJsonStringDocumentBytes,
  readResponseJsonStringWithinLimit,
  readResponseTextPrefix,
} from "#veryfront/utils/response-body.ts";

const logger = baseLogger.component("api-cache-backend");

const DEFAULT_TIMEOUT_MS = 10_000;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const ERROR_BODY_MAX_LENGTH = 500;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_RESPONSE_BYTES = 128 * 1024 * 1024;

type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

type CacheRequestOptions = {
  failOnError?: boolean;
  boundedJsonString?: { fieldName: string; maximumBytes: number };
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
  private readonly apiOrigin: string;
  private readonly hasExplicitApiBaseUrl: boolean;
  private readonly explicitApiToken?: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private readonly maxResponseBytes: number;
  private circuitBreaker;

  constructor(
    options: {
      apiBaseUrl?: string;
      /** Credential paired with a caller-selected apiBaseUrl. */
      apiToken?: string;
      keyPrefix?: string;
      timeoutMs?: number;
      maxResponseBytes?: number;
      circuitBreakerName?: string;
    } = {},
  ) {
    this.hasExplicitApiBaseUrl = options.apiBaseUrl !== undefined;
    this.apiBaseUrl = options.apiBaseUrl ??
      getHostEnv("VERYFRONT_API_BASE_URL") ??
      "https://api.veryfront.com";
    this.apiOrigin = new URL(this.apiBaseUrl).origin;
    this.explicitApiToken = options.apiToken;
    this.keyPrefix = options.keyPrefix ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 ||
      maxResponseBytes > MAX_CONFIGURED_RESPONSE_BYTES
    ) {
      throw new RangeError(
        `API cache maxResponseBytes must be a positive integer at most ${MAX_CONFIGURED_RESPONSE_BYTES}`,
      );
    }
    this.maxResponseBytes = maxResponseBytes;

    const breakerName = options.circuitBreakerName ?? "api-cache";
    this.circuitBreaker = getCircuitBreaker(breakerName, {
      failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    });
  }

  private async prefixKey(key: string): Promise<string> {
    const prefixed = this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
    const sanitized = await sanitizeCacheKey(prefixed, this.keyPrefix);
    if (sanitized === prefixed) return prefixed;

    // Defence in depth: a key that leaked raw URL/query/undefined tokens would
    // otherwise be rejected by the API with `HTTP 400: Cache key contains
    // invalid characters`, and on the control-plane /execute path that 400
    // loops until the request is flagged stuck (issues #162 / #175). Sanitize
    // so the request succeeds, and warn so the upstream generation bug stays
    // visible rather than being silently masked. Do not log any key-derived
    // value because a leaked raw URL can carry credentials.
    logger.warn("Cache key was not API-safe; sanitized before request", {
      originalLength: prefixed.length,
    });
    return sanitized;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    options: CacheRequestOptions = {},
  ): Promise<T | null> {
    let boundedJsonString:
      | { fieldName: string; maximumBytes: number; maximumDocumentBytes: number }
      | undefined;
    if (options.boundedJsonString !== undefined) {
      const maximumBytes = assertCacheReadMaximumBytes(
        options.boundedJsonString.maximumBytes,
      );
      boundedJsonString = {
        fieldName: options.boundedJsonString.fieldName,
        maximumBytes,
        maximumDocumentBytes: maximumJsonStringDocumentBytes(
          maximumBytes,
          this.maxResponseBytes,
        ),
      };
    }
    const reqCtx = getCurrentRequestContext();
    const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
    const envToken = getEnvValue("VERYFRONT_API_TOKEN");
    const verifiedCredential = getVerifiedCacheApiCredential();
    const verifiedRequestToken = verifiedCredential?.token;
    if (this.hasExplicitApiBaseUrl && !this.explicitApiToken) {
      logger.warn("Caller-selected cache API endpoint omitted its credential", {
        apiOrigin: this.apiOrigin,
      });
      return null;
    }
    // The private verified-request context cannot be changed through the
    // globally exposed filesystem request context.
    const token = this.explicitApiToken ?? verifiedRequestToken ?? hostToken ?? reqCtx?.token ??
      envToken ?? null;
    const tokenSource = this.explicitApiToken
      ? "explicit-endpoint"
      : verifiedRequestToken
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
              guardedOutboundFetch(
                url,
                {
                  method,
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: body ? JSON.stringify(body) : undefined,
                  signal: controller.signal,
                  redirect: "error",
                },
                {
                  authorizeUrl: (target) => {
                    if (target.origin !== this.apiOrigin) {
                      throw new OutboundRequestBlockedError(
                        "Cache API request blocked: destination origin is not authorized",
                      );
                    }
                  },
                },
              ),
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
              responseBody = (await readResponseTextPrefix(
                response,
                ERROR_BODY_MAX_LENGTH + 1,
                controller.signal,
                { fatalUtf8: true },
              )).text;
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

          if (boundedJsonString !== undefined) {
            try {
              return await readResponseJsonStringWithinLimit(
                response,
                boundedJsonString.fieldName,
                boundedJsonString.maximumBytes,
                boundedJsonString.maximumDocumentBytes,
                controller.signal,
                this.maxResponseBytes,
              ) as T;
            } catch (error) {
              if (error instanceof JsonStringValueTooLargeError) {
                throw new CacheValueTooLargeError(boundedJsonString.maximumBytes);
              }
              throw error;
            }
          }

          const { text, truncated } = await readResponseTextPrefix(
            response,
            this.maxResponseBytes + 1,
            controller.signal,
            { fatalUtf8: true },
          );
          if (truncated) {
            throw REQUEST_ERROR.create({
              detail: `Cache API response exceeded ${this.maxResponseBytes} bytes`,
            });
          }
          return JSON.parse(text) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { isNeutralError: (error) => error instanceof CacheValueTooLargeError });
    } catch (error) {
      if (error instanceof CacheValueTooLargeError) throw error;
      if (error instanceof CircuitBreakerOpen) {
        logger.info("Circuit breaker open, failing fast", {
          path: sanitizeUrlForSpan(path),
          nextAttemptMs: error.nextAttemptMs,
        });
        if (options.failOnError) throw error;
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
      if (options.failOnError) throw error;
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    const prefixedKey = await this.prefixKey(key);
    const result = await this.request<{ value: string | null }>(
      "GET",
      `/get?key=${encodeURIComponent(prefixedKey)}`,
    );
    return result?.value ?? null;
  }

  async getWithinLimit(key: string, maximumBytes: number): Promise<string | null> {
    const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
    const prefixedKey = await this.prefixKey(key);
    const result = await this.request<string>(
      "GET",
      `/get?key=${encodeURIComponent(prefixedKey)}`,
      undefined,
      { boundedJsonString: { fieldName: "value", maximumBytes: admittedMaximum } },
    );
    if (result === null) return null;
    if (typeof result !== "string") {
      throw new TypeError("Cache API bounded get returned a non-string value");
    }
    assertCacheValueWithinLimit(result, admittedMaximum);
    return result;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(
      await Promise.all(keys.map(async (key) => [key, await this.prefixKey(key)] as const)),
    );
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
      key: await this.prefixKey(key),
      value,
      ttl: ttlSeconds,
    });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    const prefixedEntries = await Promise.all(
      entries.map(async ({ key, value, ttl }) => ({
        key: await this.prefixKey(key),
        value,
        ttl,
      })),
    );

    await this.request("POST", "/set-batch", { entries: prefixedEntries });
  }

  async del(key: string): Promise<void> {
    await this.request(
      "POST",
      "/del",
      { key: await this.prefixKey(key) },
      { failOnError: true },
    );
  }

  async delByPattern(pattern: string): Promise<number> {
    const prefixed = this.keyPrefix ? `${this.keyPrefix}:${pattern}` : pattern;

    // A pattern is a glob: `*` is a wildcard, not a literal. We must NOT escape
    // invalid characters here because rewriting a glob could broaden its
    // deletion scope. Fail closed instead: refuse a malformed pattern (leaving
    // the entries to expire on TTL) rather than risk deleting unrelated keys.
    if (!isValidCachePattern(prefixed)) {
      logger.warn("Refusing unsafe del-pattern; skipping", {
        originalLength: prefixed.length,
      });
      return 0;
    }

    const result = await this.request<{ deleted: number }>("POST", "/del-pattern", {
      pattern: prefixed,
    }, { failOnError: true });
    return result?.deleted ?? 0;
  }
}
