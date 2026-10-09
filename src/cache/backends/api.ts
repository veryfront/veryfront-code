import { logger as baseLogger, sanitizeUrlForSpan } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isValidCachePattern, sanitizeCacheKey } from "../keys/index.ts";
import {
  CircuitBreaker,
  CircuitBreakerOpen,
  getCircuitBreaker,
} from "#veryfront/utils/circuit-breaker.ts";
import type { CacheBackend, CacheReadOptions } from "../types.ts";
import { buildBatchResults } from "../batch-results.ts";
import {
  cacheCredentialIdentity,
  resolveCacheRequestAuthority,
  type ResolvedCacheAuthority,
} from "#veryfront/cache/request-authority.ts";
import { REQUEST_ERROR } from "#veryfront/errors";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
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
const MAX_EXPIRATION_CONCURRENCY = 8;
// Canonical cache entries API accepts at most 100 distinct keys per batch.
const MAX_ENTRIES_PER_BATCH = 100;
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const CIRCUIT_BREAKER_OPTIONS = {
  failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
};
/** Project invalidation breakers one backend keeps, least recently used first out. */
const MAX_INVALIDATION_CIRCUIT_BREAKERS = 256;
const ERROR_BODY_MAX_LENGTH = 500;
const DEFAULT_API_BASE_URL = "https://api.veryfront.com";
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_RESPONSE_BYTES = 128 * 1024 * 1024;
/** Longest TTL the cache entry API accepts (`ttl_seconds` is 1 to 86400). */
const API_CACHE_MAX_TTL_SECONDS = 86_400;
/**
 * Operation templates recorded in spans and logs. A cache key sits in the
 * request path, and keys can embed identifiers, so telemetry records the route
 * template and never the key.
 */
const ENTRY_OPERATION = "/entries/{key}";
const ENTRIES_OPERATION = "/entries";
const READ_ENTRIES_OPERATION = "/entries/read";
const WRITE_ENTRIES_OPERATION = "/entries/write";
const NativeURL = URL;
const applyIntrinsic = Reflect.apply;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;
const urlHostGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "host")?.get;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringEndsWith = String.prototype.endsWith;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;

function normalizeConfiguredApiBaseUrl(value: string, graphqlUrl = false): string {
  const trimmed = applyIntrinsic(stringTrim, value, []) as string;
  let end = trimmed.length;
  while (end > 0 && applyIntrinsic(stringCharCodeAt, trimmed, [end - 1]) === 47) end--;
  const normalized = applyIntrinsic(stringSlice, trimmed, [0, end]) as string;
  return graphqlUrl && applyIntrinsic(stringEndsWith, normalized, ["/graphql"])
    ? `${applyIntrinsic(stringSlice, normalized, [0, -"/graphql".length]) as string}/api`
    : normalized;
}

function resolveConfiguredApiBaseUrl(): string {
  const apiBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
  const normalizedApiBaseUrl = apiBaseUrl && normalizeConfiguredApiBaseUrl(apiBaseUrl);
  if (normalizedApiBaseUrl) return normalizedApiBaseUrl;
  const apiUrl = getHostEnv("VERYFRONT_API_URL");
  const normalizedApiUrl = apiUrl && normalizeConfiguredApiBaseUrl(apiUrl, true);
  return normalizedApiUrl || DEFAULT_API_BASE_URL;
}

function readUrlProperty(
  url: URL,
  getter: ((this: URL) => string) | undefined,
): string {
  if (!getter) throw new TypeError("Native URL accessor is unavailable");
  return applyIntrinsic(getter, url, []) as string;
}

type CacheRequestOptions = {
  failOnError?: boolean;
  /**
   * Route template recorded as `cache.operation`, in `http.url` and in logs
   * instead of the request path, so a key in the path never reaches telemetry.
   */
  operation: string;
  boundedJsonString?: { fieldName: string; maximumBytes: number };
  /**
   * Reports the authority this request resolves at the moment it performs the
   * read, so a caller holding results in front of the authority gate can bind
   * what it holds to the credential and project that actually fetched them.
   */
  onAuthority?: (authority: ResolvedCacheAuthority) => void;
  /** Breaker the request runs through; defaults to the read breaker. */
  circuitBreaker?: CircuitBreaker;
  /**
   * A refused credential says nothing about the backend's health, so it must
   * not open a breaker that callers with valid credentials share.
   */
  credentialRejectionIsNeutral?: boolean;
};

/** One item of a cache entry read: a hit carries the value, a miss found=false. */
type CacheEntryResult = { key: string; found: boolean; value: string | null };

/**
 * Maps a backend TTL to the cache entry API's `ttl_seconds`, a whole number of
 * seconds from 1 to {@link API_CACHE_MAX_TTL_SECONDS}. A non-positive TTL
 * expires the entry at once (see `CacheBackend.set`), and a non-finite TTL
 * (NaN or either infinity) is invalid, so it neither writes nor expires.
 */
function toApiTtlSeconds(ttlSeconds: number): number | "expire" | "invalid" {
  if (!Number.isFinite(ttlSeconds)) return "invalid";
  if (ttlSeconds <= 0) return "expire";
  return Math.min(Math.ceil(ttlSeconds), API_CACHE_MAX_TTL_SECONDS);
}

function entryPath(prefixedKey: string): string {
  return `/entries/${encodeURIComponent(prefixedKey)}`;
}

/**
 * The pattern delete running now and the one queued behind it, with the
 * identity of the credential the queued one runs under.
 */
type PatternDeleteRound = {
  current: Promise<number>;
  next?: Promise<number>;
  nextCredential?: string;
};

const ignoreSettlement = (): void => {};

/** The cache API refused the credential itself, not the operation. */
export function isCacheCredentialRejection(error: unknown): boolean {
  if (!(error instanceof VeryfrontError)) return false;
  const context = error.context as { upstreamStatus?: unknown } | undefined;
  return context?.upstreamStatus === 401 || context?.upstreamStatus === 403;
}

export class ApiCacheBackend implements CacheBackend {
  readonly type = "api" as const;
  private apiBaseUrl: string;
  private readonly hostApiBaseUrl: string;
  private readonly apiOrigin: string;
  private readonly hasExplicitApiBaseUrl: boolean;
  private readonly explicitApiToken?: string;
  private keyPrefix: string;
  private timeoutMs: number;
  private readonly maxResponseBytes: number;
  private circuitBreaker: CircuitBreaker;
  private readonly circuitBreakerName: string;
  private readonly patternDeleteRounds = new Map<string, PatternDeleteRound>();
  private readonly invalidationCircuitBreakers = new Map<string, CircuitBreaker>();

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
    this.apiBaseUrl = options.apiBaseUrl ?? resolveConfiguredApiBaseUrl();
    this.hostApiBaseUrl = resolveHostOwnedApiBaseUrl();
    this.apiOrigin = readUrlProperty(new NativeURL(this.apiBaseUrl), urlOriginGetter);
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
    this.circuitBreakerName = breakerName;
    this.circuitBreaker = getCircuitBreaker(breakerName, CIRCUIT_BREAKER_OPTIONS);
  }

  /**
   * The authority every read through this backend is gated on. Exposed so the
   * process-local file-cache tier scopes what it holds on this backend's own
   * resolution, including a caller-selected endpoint credential, rather than
   * re-deriving the ambient one and drifting from the gate it sits in front of.
   */
  cacheAuthority(): ResolvedCacheAuthority {
    return resolveCacheRequestAuthority(this.explicitApiToken);
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
    body: Record<string, unknown> | undefined,
    options: CacheRequestOptions,
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
    if (this.hasExplicitApiBaseUrl && !this.explicitApiToken) {
      logger.warn("Caller-selected cache API endpoint omitted its credential", {
        apiOrigin: this.apiOrigin,
      });
      return null;
    }
    // Shared with the process-local file-cache tier, which must scope what it
    // holds on exactly the authority this read would have been made under.
    // Resolved here, when the request is performed, and reported to the caller
    // before the gate below: a caller admitting results into a local tier must
    // learn about every authority that could have fetched them.
    const authority = this.cacheAuthority();
    options.onAuthority?.(authority);
    const { token, projectRef, tokenSource } = authority;
    const { operation } = options;

    if (!token || !projectRef) {
      logger.debug("Missing auth or project context", {
        tokenSource,
        hasProjectRef: !!projectRef,
      });
      return null;
    }

    try {
      const circuitBreaker = options.circuitBreaker ?? this.circuitBreaker;
      return await circuitBreaker.execute(async () => {
        const encodedProjectRef = encodeURIComponent(projectRef);
        const apiBaseUrl = tokenSource === "verified-control-plane" ||
            !this.hasExplicitApiBaseUrl && tokenSource === "host-private"
          ? this.hostApiBaseUrl
          : this.apiBaseUrl;
        if (tokenSource === "host-private") requireHostPrivateApiHttps(apiBaseUrl);
        const parsedApiBaseUrl = new NativeURL(apiBaseUrl);
        const apiOrigin = readUrlProperty(parsedApiBaseUrl, urlOriginGetter);
        const cacheBaseUrl = `${apiBaseUrl}/projects/${encodedProjectRef}/cache`;
        const url = `${cacheBaseUrl}${path}`;
        // The operation is a route template; appended after sanitizing so its
        // braces stay readable.
        const spanUrl = `${sanitizeUrlForSpan(cacheBaseUrl)}${operation}`;
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
                    if (readUrlProperty(target, urlOriginGetter) !== apiOrigin) {
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
              "http.host": readUrlProperty(parsedApiBaseUrl, urlHostGetter),
              "cache.operation": operation,
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
              context: { upstreamStatus: response.status },
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
      }, {
        isNeutralError: (error) =>
          error instanceof CacheValueTooLargeError ||
          options.credentialRejectionIsNeutral === true && isCacheCredentialRejection(error),
      });
    } catch (error) {
      if (error instanceof CacheValueTooLargeError) throw error;
      if (error instanceof CircuitBreakerOpen) {
        logger.info("Circuit breaker open, failing fast", {
          path: operation,
          nextAttemptMs: error.nextAttemptMs,
        });
        if (options.failOnError) throw error;
        return null;
      }

      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.info(`Request ${isTimeout ? "timeout" : "error"}`, {
        path: operation,
        error: errorMsg,
        isTimeout,
        tokenSource,
        projectRef,
      });
      if (options.failOnError) throw error;
      return null;
    }
  }

  async get(key: string, options?: CacheReadOptions): Promise<string | null> {
    const prefixedKey = await this.prefixKey(key);
    const result = await this.request<CacheEntryResult>(
      "GET",
      entryPath(prefixedKey),
      undefined,
      { onAuthority: options?.onAuthority, operation: ENTRY_OPERATION },
    );
    // A miss carries found=false and a null value.
    return result?.found === false || typeof result?.value !== "string" ? null : result.value;
  }

  async getWithinLimit(key: string, maximumBytes: number): Promise<string | null> {
    const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
    const prefixedKey = await this.prefixKey(key);
    // A miss returns found=false with a null value, which the bounded reader
    // reports as null.
    const result = await this.request<string>(
      "GET",
      entryPath(prefixedKey),
      undefined,
      {
        boundedJsonString: { fieldName: "value", maximumBytes: admittedMaximum },
        operation: ENTRY_OPERATION,
      },
    );
    if (result === null) return null;
    if (typeof result !== "string") {
      throw new TypeError("Cache API bounded get returned a non-string value");
    }
    assertCacheValueWithinLimit(result, admittedMaximum);
    return result;
  }

  async getBatch(
    keys: string[],
    options?: CacheReadOptions,
  ): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(
      await Promise.all(keys.map(async (key) => [key, await this.prefixKey(key)] as const)),
    );
    // The API refuses a read that names a key twice; two requested keys can
    // also sanitize to the same prefixed key.
    const prefixedKeys = [...new Set(prefixedByKey.values())];
    const hits = new Map<string, string>();
    for (let offset = 0; offset < prefixedKeys.length; offset += MAX_ENTRIES_PER_BATCH) {
      const batch = prefixedKeys.slice(offset, offset + MAX_ENTRIES_PER_BATCH);
      const response = await this.request<{ data?: CacheEntryResult[] }>(
        "POST",
        READ_ENTRIES_OPERATION,
        { keys: batch },
        { onAuthority: options?.onAuthority, operation: READ_ENTRIES_OPERATION },
      );
      if (Array.isArray(response?.data)) {
        for (const entry of response.data) {
          if (entry?.found !== false && typeof entry?.value === "string") {
            hits.set(entry.key, entry.value);
          }
        }
      } else {
        // Avoid multiplying an unavailable batch endpoint into per-key retries.
        logger.warn("Batch cache read failed; treating its keys as misses", {
          keyCount: batch.length,
        });
      }
    }

    return buildBatchResults(keys, (key) => hits.get(prefixedByKey.get(key) as string) ?? null);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    const prefixedKey = await this.prefixKey(key);
    const ttl = toApiTtlSeconds(ttlSeconds);
    if (ttl === "invalid") {
      logger.warn("Refusing cache write with a non-finite TTL; skipping", { keyCount: 1 });
      return;
    }
    if (ttl === "expire") {
      await this.expireImmediately([prefixedKey]);
      return;
    }
    await this.request("PUT", entryPath(prefixedKey), { value, ttl_seconds: ttl }, {
      operation: ENTRY_OPERATION,
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

    // The API refuses a write that names a key twice. Applied in order, the
    // last entry for a key wins, so keep only that one.
    const lastByKey = new Map<string, (typeof prefixedEntries)[number]>();
    for (const entry of prefixedEntries) {
      lastByKey.delete(entry.key);
      lastByKey.set(entry.key, entry);
    }

    const writes: Array<{ key: string; value: string; ttl_seconds?: number }> = [];
    const expired: string[] = [];
    let invalid = 0;
    for (const { key, value, ttl } of lastByKey.values()) {
      if (ttl === undefined) {
        writes.push({ key, value });
        continue;
      }
      const ttlSeconds = toApiTtlSeconds(ttl);
      if (ttlSeconds === "invalid") {
        invalid++;
      } else if (ttlSeconds === "expire") {
        expired.push(key);
      } else {
        writes.push({ key, value, ttl_seconds: ttlSeconds });
      }
    }

    if (invalid > 0) {
      logger.warn("Refusing cache write with a non-finite TTL; skipping", { keyCount: invalid });
    }
    if (expired.length > 0) await this.expireImmediately(expired);
    if (writes.length === 0) return;
    for (let offset = 0; offset < writes.length; offset += MAX_ENTRIES_PER_BATCH) {
      await this.request("POST", WRITE_ENTRIES_OPERATION, {
        entries: writes.slice(offset, offset + MAX_ENTRIES_PER_BATCH),
      }, { operation: WRITE_ENTRIES_OPERATION });
    }
  }

  /**
   * A non-positive TTL expires the entry at once (see `CacheBackend.set`): the
   * existing entry is removed and nothing is stored. Best effort, like every
   * write through this backend.
   */
  private async expireImmediately(prefixedKeys: string[]): Promise<void> {
    for (let offset = 0; offset < prefixedKeys.length; offset += MAX_EXPIRATION_CONCURRENCY) {
      await Promise.all(
        prefixedKeys.slice(offset, offset + MAX_EXPIRATION_CONCURRENCY).map((prefixedKey) =>
          this.request("DELETE", entryPath(prefixedKey), undefined, {
            operation: ENTRY_OPERATION,
          })
        ),
      );
    }
  }

  async del(key: string): Promise<void> {
    await this.request(
      "DELETE",
      entryPath(await this.prefixKey(key)),
      undefined,
      { failOnError: true, operation: ENTRY_OPERATION },
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

    const { token, projectRef, tokenSource } = this.cacheAuthority();
    // Pattern deletes are best-effort invalidations. They run through their
    // own breaker, scoped to the project, so a slow or failing invalidation
    // backend cannot open the breaker every cache read (agent streams,
    // execute, agents/list) depends on, nor stop other projects' invalidations.
    const invalidationCircuitBreaker = this.invalidationCircuitBreaker(projectRef ?? "");
    const deletePattern = async () => {
      const result = await this.request<{ deleted_count?: number }>(
        "DELETE",
        `${ENTRIES_OPERATION}?pattern=${encodeURIComponent(prefixed)}`,
        undefined,
        {
          failOnError: true,
          circuitBreaker: invalidationCircuitBreaker,
          credentialRejectionIsNeutral: true,
          operation: ENTRIES_OPERATION,
        },
      );
      return result?.deleted_count ?? 0;
    };

    if (!token || !projectRef) return await deletePattern();
    return await this.coalescePatternDelete(
      JSON.stringify([tokenSource, projectRef, prefixed]),
      cacheCredentialIdentity(token),
      deletePattern,
    );
  }

  /**
   * Kept per backend and bounded, not in the process-wide registry: a runtime
   * serving many short-lived projects must not grow one breaker per project.
   * Dropping a breaker only forgets its failures, so the next delete is tried.
   */
  private invalidationCircuitBreaker(projectRef: string): CircuitBreaker {
    let breaker = this.invalidationCircuitBreakers.get(projectRef);
    if (breaker) {
      this.invalidationCircuitBreakers.delete(projectRef);
    } else {
      breaker = new CircuitBreaker({
        ...CIRCUIT_BREAKER_OPTIONS,
        name: `${this.circuitBreakerName}:invalidation:${projectRef}`,
      });
    }
    this.invalidationCircuitBreakers.set(projectRef, breaker);
    if (this.invalidationCircuitBreakers.size > MAX_INVALIDATION_CIRCUIT_BREAKERS) {
      const leastRecentlyUsed = this.invalidationCircuitBreakers.keys().next().value;
      if (leastRecentlyUsed !== undefined) {
        this.invalidationCircuitBreakers.delete(leastRecentlyUsed);
      }
    }
    return breaker;
  }

  /**
   * Every active run stream on a project invalidates the same patterns for one
   * file write. Callers that arrive while a delete for the same project and
   * pattern is in flight share one delete queued behind it, so N streams cost
   * at most two requests. The queued delete starts after every joined call, so
   * no caller relies on a scan that began before it asked. A caller whose
   * credential differs from the one the shared delete ran under retries on its
   * own when the API refused that credential.
   */
  private coalescePatternDelete(
    key: string,
    credential: string,
    run: () => Promise<number>,
  ): Promise<number> {
    const round = this.patternDeleteRounds.get(key);
    if (round) {
      if (round.next === undefined) {
        round.next = round.current.then(ignoreSettlement, ignoreSettlement).then(run);
        round.nextCredential = credential;
      }
      if (round.nextCredential === credential) return round.next;
      return round.next.catch((error: unknown) => {
        if (!isCacheCredentialRejection(error)) throw error;
        return run();
      });
    }

    const started: PatternDeleteRound = { current: run() };
    this.patternDeleteRounds.set(key, started);
    const advance = () => {
      if (started.next === undefined) {
        this.patternDeleteRounds.delete(key);
        return;
      }
      started.current = started.next;
      started.next = undefined;
      started.nextCredential = undefined;
      started.current.then(advance, advance);
    };
    started.current.then(advance, advance);
    return started.current;
  }
}
