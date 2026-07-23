import { logger as baseLogger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { tryGetCacheKeyContext } from "../cache-key-builder.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend } from "../types.ts";
import { getEnvValue } from "./helpers.ts";
import { buildBatchResults } from "../batch-results.ts";
import { INVALID_ARGUMENT, REQUEST_ERROR } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getVerifiedCacheApiCredential } from "../verified-api-credential-context.ts";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const logger = baseLogger.component("api-cache-backend");

const DEFAULT_TIMEOUT_MS = 10_000;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const MAX_API_BASE_URL_LENGTH = 2048;
const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_KEY_PREFIX_LENGTH = 512;
const MAX_CACHE_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BATCH_VALUE_BYTES = MAX_CACHE_VALUE_BYTES;
const MAX_API_JSON_RESPONSE_BYTES = MAX_CACHE_VALUE_BYTES + 8 * 1024 * 1024;
const MAX_CACHE_BATCH_ENTRIES = 100;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_API_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CIRCUIT_BREAKER_NAME_LENGTH = 128;
const valueEncoder = new TextEncoder();

type CacheRequestContext = {
  token?: string;
  projectId?: string;
  projectSlug?: string;
};

type CacheRequestOptions = {
  failOnError?: boolean;
  parseJson?: boolean;
};

let warnedMissingAdapterContract = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxLength || containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
}

function normalizeTtl(ttlSeconds: unknown, fallback: number): number {
  const ttl = ttlSeconds ?? fallback;
  if (
    typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 ||
    ttl > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a positive finite number within the supported range");
  }
  return ttl;
}

function readOption(options: object, key: string): unknown {
  try {
    return Reflect.get(options, key);
  } catch {
    invalidArgument("API cache options must be readable");
  }
}

function normalizeApiBaseUrl(value: unknown): string {
  assertBoundedString(value, "API cache base URL", MAX_API_BASE_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidArgument("API cache base URL must be a valid HTTP URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username ||
    parsed.password || parsed.search || parsed.hash
  ) {
    invalidArgument("API cache base URL must be an HTTP URL without credentials or query data");
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeOptions(value: unknown): {
  apiBaseUrl: string;
  keyPrefix: string;
  timeoutMs: number;
  circuitBreakerName: string;
} {
  if (!isRecord(value)) invalidArgument("API cache options must be an object");

  const configuredUrl = readOption(value, "apiBaseUrl");
  const envUrl = getHostEnv("VERYFRONT_API_BASE_URL") ?? getEnvValue("VERYFRONT_API_BASE_URL");
  const apiBaseUrl = normalizeApiBaseUrl(configuredUrl ?? envUrl ?? "https://api.veryfront.com");

  const keyPrefix = readOption(value, "keyPrefix") ?? "";
  assertBoundedString(keyPrefix, "API cache key prefix", MAX_CACHE_KEY_PREFIX_LENGTH, true);

  const timeoutMs = readOption(value, "timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > MAX_API_TIMEOUT_MS
  ) {
    invalidArgument("API cache timeout must be a positive safe integer within the supported range");
  }

  const circuitBreakerName = readOption(value, "circuitBreakerName") ?? "api-cache";
  assertBoundedString(
    circuitBreakerName,
    "API cache circuit breaker name",
    MAX_CIRCUIT_BREAKER_NAME_LENGTH,
  );
  return Object.freeze({ apiBaseUrl, keyPrefix, timeoutMs, circuitBreakerName });
}

function assertCacheKey(key: unknown): asserts key is string {
  assertBoundedString(key, "Cache key", MAX_CACHE_KEY_LENGTH);
}

function normalizeCacheValue(value: unknown): { value: string; byteLength: number } {
  if (typeof value !== "string" || value.length > MAX_CACHE_VALUE_BYTES) {
    invalidArgument("Cache value must be a string within the supported byte size");
  }
  const byteLength = valueEncoder.encode(value).byteLength;
  if (byteLength > MAX_CACHE_VALUE_BYTES) {
    invalidArgument("Cache value must be a string within the supported byte size");
  }
  return { value, byteLength };
}

function assertCacheValue(value: unknown): asserts value is string {
  normalizeCacheValue(value);
}

function isCacheReadValue(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && valueEncoder.encode(value).byteLength <= MAX_CACHE_VALUE_BYTES);
}

function buildBoundedReadResults(
  keys: string[],
  getValue: (key: string) => unknown,
): Map<string, string | null> {
  let totalValueBytes = 0;
  let exceeded = false;
  const results = buildBatchResults(keys, (key) => {
    const value = getValue(key);
    if (!isCacheReadValue(value)) return null;
    if (value !== null) {
      totalValueBytes += valueEncoder.encode(value).byteLength;
      if (totalValueBytes > MAX_CACHE_BATCH_VALUE_BYTES) exceeded = true;
    }
    return value;
  });
  if (!exceeded) return results;
  logger.warn("API cache returned an oversized batch response");
  return buildBatchResults(keys, () => null);
}

async function readJsonResponseBounded(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      await response.body?.cancel().catch(() => undefined);
      throw REQUEST_ERROR.create({ detail: "API cache returned an invalid content length" });
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > MAX_API_JSON_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw REQUEST_ERROR.create({ detail: "API cache response exceeds the supported size" });
    }
  }

  if (!response.body) {
    throw REQUEST_ERROR.create({ detail: "API cache returned an empty JSON response" });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_API_JSON_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw REQUEST_ERROR.create({ detail: "API cache response exceeds the supported size" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw REQUEST_ERROR.create({ detail: "API cache returned invalid JSON" });
  }
}

function assertBatchSize(values: unknown[]): void {
  if (values.length > MAX_CACHE_BATCH_ENTRIES) {
    invalidArgument("Cache batch exceeds the supported entry count");
  }
}

function getCurrentRequestContext(): CacheRequestContext | null {
  const adapter = (globalThis as Record<string, unknown>).__vf_multi_project_adapter;

  // The adapter is installed dynamically, so validate its shape instead of an
  // unchecked cast. If it exists but no longer exposes getCurrentRequestContext
  // (e.g., renamed/moved), the API cache would otherwise silently fail to
  // authenticate forever with only a debug log, so warn once with a visible message.
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

  let ctx: unknown;
  try {
    ctx = (adapter.getCurrentRequestContext as () => unknown)();
    if (!isRecord(ctx)) return null;
    const token = Reflect.get(ctx, "token");
    const projectId = Reflect.get(ctx, "projectId");
    const projectSlug = Reflect.get(ctx, "projectSlug");
    return {
      token: typeof token === "string" ? token : undefined,
      projectId: typeof projectId === "string" ? projectId : undefined,
      projectSlug: typeof projectSlug === "string" ? projectSlug : undefined,
    };
  } catch {
    logger.warn("Multi-project request context could not be read");
    return null;
  }
}

export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private readonly apiBaseUrl: string;
  private readonly keyPrefix: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker;

  constructor(
    options: {
      apiBaseUrl?: string;
      keyPrefix?: string;
      timeoutMs?: number;
      circuitBreakerName?: string;
    } = {},
  ) {
    const normalized = normalizeOptions(options);
    this.apiBaseUrl = normalized.apiBaseUrl;
    this.keyPrefix = normalized.keyPrefix;
    this.timeoutMs = normalized.timeoutMs;

    this.circuitBreaker = getCircuitBreaker(normalized.circuitBreakerName, {
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
    options: CacheRequestOptions = {},
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
      if (options.failOnError) {
        throw REQUEST_ERROR.create({
          detail: "API cache mutation requires an authenticated project context",
        });
      }
      return null;
    }
    try {
      assertBoundedString(token, "API cache credential", 16_384);
      assertBoundedString(projectRef, "API cache project reference", MAX_CACHE_KEY_LENGTH);
    } catch (error) {
      logger.warn("Invalid API cache authentication context", { tokenSource });
      if (options.failOnError) throw error;
      return null;
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const encodedProjectRef = encodeURIComponent(projectRef);
        const url = `${this.apiBaseUrl}/projects/${encodedProjectRef}/cache${path}`;
        const cacheOperation = path.split("?", 1)[0] ?? "unknown";
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
              "http.url": `/projects/<PROJECT_ID>/cache${cacheOperation}`,
              "cache.operation": cacheOperation,
            },
          );

          if (!response.ok) {
            try {
              await response.body?.cancel();
            } catch {
              logger.debug("Failed to discard API cache error response", {
                status: response.status,
              });
            }
            throw REQUEST_ERROR.create({
              detail: `API cache request failed with HTTP ${response.status}`,
            });
          }

          if (options.parseJson === false) {
            await response.body?.cancel().catch(() => undefined);
            return null;
          }
          return (await readJsonResponseBounded(response)) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.info("Circuit breaker open, failing fast", {
          operation: path.split("?", 1)[0],
          nextAttemptMs: error.nextAttemptMs,
        });
        if (options.failOnError) throw error;
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      logger.info(`Request ${isTimeout ? "timeout" : "error"}`, {
        operation: path.split("?", 1)[0],
        errorName: error instanceof Error ? error.name : typeof error,
        isTimeout,
      });
      if (options.failOnError) throw error;
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    assertCacheKey(key);
    const result = await this.request<unknown>(
      "GET",
      `/get?key=${encodeURIComponent(this.prefixKey(key))}`,
    );
    if (!isRecord(result) || !isCacheReadValue(result.value)) {
      if (result !== null) logger.warn("API cache returned an invalid get response");
      return null;
    }
    return result.value;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (!Array.isArray(keys)) invalidArgument("Cache batch must be an array");
    assertBatchSize(keys);
    for (const key of keys) assertCacheKey(key);
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(keys.map((k) => [k, this.prefixKey(k)] as const));
    const response = await this.request<unknown>(
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
    const responseValues = response.values;

    return buildBoundedReadResults(keys, (key) => {
      const prefixedKey = prefixedByKey.get(key) as string;
      if (!Object.hasOwn(responseValues, prefixedKey)) return null;
      return responseValues[prefixedKey];
    });
  }

  private async getIndividually(keys: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    let totalValueBytes = 0;
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== null) {
        totalValueBytes += valueEncoder.encode(value).byteLength;
        if (totalValueBytes > MAX_CACHE_BATCH_VALUE_BYTES) {
          logger.warn("API cache fallback returned an oversized batch response");
          return buildBatchResults(keys, () => null);
        }
      }
      results.set(key, value);
    }
    return buildBatchResults(keys, (key) => results.get(key) ?? null);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    assertCacheKey(key);
    assertCacheValue(value);
    const ttl = normalizeTtl(ttlSeconds, 300);
    await this.request("POST", "/set", {
      key: this.prefixKey(key),
      value,
      ttl,
    }, { failOnError: true, parseJson: false });
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    if (!Array.isArray(entries)) invalidArgument("Cache batch must be an array");
    assertBatchSize(entries);
    if (entries.length === 0) return;

    let totalValueBytes = 0;
    const prefixedEntries = entries.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        invalidArgument("Cache batch entry must be an object");
      }
      let key: unknown;
      let value: unknown;
      let ttl: unknown;
      try {
        key = Reflect.get(entry, "key");
        value = Reflect.get(entry, "value");
        ttl = Reflect.get(entry, "ttl");
      } catch {
        invalidArgument("Cache batch entry must be readable");
      }
      assertCacheKey(key);
      const normalizedValue = normalizeCacheValue(value);
      totalValueBytes += normalizedValue.byteLength;
      if (totalValueBytes > MAX_CACHE_BATCH_VALUE_BYTES) {
        invalidArgument("Cache batch values exceed the supported byte size");
      }
      return {
        key: this.prefixKey(key),
        value: normalizedValue.value,
        ttl: normalizeTtl(ttl, 300),
      };
    });

    await this.request("POST", "/set-batch", { entries: prefixedEntries }, {
      failOnError: true,
      parseJson: false,
    });
  }

  async del(key: string): Promise<void> {
    assertCacheKey(key);
    await this.request("POST", "/del", { key: this.prefixKey(key) }, {
      failOnError: true,
      parseJson: false,
    });
  }

  async delByPattern(pattern: string): Promise<number> {
    assertCacheKey(pattern);
    const result = await this.request<unknown>("POST", "/del-pattern", {
      pattern: this.prefixKey(pattern),
    }, { failOnError: true });
    if (result === null) return 0;
    if (
      !isRecord(result) || typeof result.deleted !== "number" ||
      !Number.isSafeInteger(result.deleted) || result.deleted < 0
    ) {
      throw REQUEST_ERROR.create({ detail: "API cache returned an invalid delete response" });
    }
    return result.deleted;
  }
}
