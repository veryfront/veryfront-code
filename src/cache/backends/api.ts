import { logger as baseLogger, sanitizeUrlForSpan } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isValidCachePattern, sanitizeCacheKey } from "../keys/index.ts";
import {
  type CircuitBreaker,
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
const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 15_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const CIRCUIT_BREAKER_OPTIONS = {
  failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  resetTimeoutMs: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  successThreshold: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
};
const ERROR_BODY_MAX_LENGTH = 500;
const DEFAULT_API_BASE_URL = "https://api.veryfront.com";
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_RESPONSE_BYTES = 128 * 1024 * 1024;
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
function isCredentialRejection(error: unknown): boolean {
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
    if (this.hasExplicitApiBaseUrl && !this.explicitApiToken) {
      logger.warn("Caller-selected cache API endpoint omitted its credential", {
        apiOrigin: this.apiOrigin,
      });
      return null;
    }
    // Shared with the process-local file-cache tier, which must scope what it
    // holds on exactly the authority this read would have been made under.
    // Resolved here, when the request is performed, and reported to the caller
    // before the gate below: a batched read that fails over to individual gets
    // re-resolves the authority per attempt, and a caller admitting results
    // into a local tier must learn about every authority that could have
    // fetched them.
    const authority = this.cacheAuthority();
    options.onAuthority?.(authority);
    const { token, projectRef, tokenSource } = authority;

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
        const url = `${apiBaseUrl}/projects/${encodedProjectRef}/cache${path}`;
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
          options.credentialRejectionIsNeutral === true && isCredentialRejection(error),
      });
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

  async get(key: string, options?: CacheReadOptions): Promise<string | null> {
    const prefixedKey = await this.prefixKey(key);
    const result = await this.request<{ value: string | null }>(
      "GET",
      `/get?key=${encodeURIComponent(prefixedKey)}`,
      undefined,
      { onAuthority: options?.onAuthority },
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

  async getBatch(
    keys: string[],
    options?: CacheReadOptions,
  ): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    const prefixedByKey = new Map(
      await Promise.all(keys.map(async (key) => [key, await this.prefixKey(key)] as const)),
    );
    const response = await this.request<{ values: Record<string, string | null> }>(
      "POST",
      "/get-batch",
      { keys: keys.map((k) => prefixedByKey.get(k) as string) },
      { onAuthority: options?.onAuthority },
    );

    if (!response?.values) {
      logger.debug("Batch endpoint failed, falling back to individual gets", {
        keyCount: keys.length,
      });
      return this.getIndividually(keys, options);
    }

    return buildBatchResults(keys, (key) => {
      const prefixedKey = prefixedByKey.get(key) as string;
      return response.values[prefixedKey] ?? null;
    });
  }

  private async getIndividually(
    keys: string[],
    options?: CacheReadOptions,
  ): Promise<Map<string, string | null>> {
    const results = await Promise.all(
      keys.map(async (key) => [key, await this.get(key, options)] as const),
    );
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

    const { token, projectRef, tokenSource } = this.cacheAuthority();
    // Pattern deletes are best-effort invalidations. They run through their
    // own breaker, scoped to the project, so a slow or failing invalidation
    // backend cannot open the breaker every cache read (agent streams,
    // execute, agents/list) depends on, nor stop other projects' invalidations.
    const invalidationCircuitBreaker = getCircuitBreaker(
      `${this.circuitBreakerName}:invalidation:${projectRef ?? ""}`,
      CIRCUIT_BREAKER_OPTIONS,
    );
    const deletePattern = async () => {
      const result = await this.request<{ deleted: number }>("POST", "/del-pattern", {
        pattern: prefixed,
      }, {
        failOnError: true,
        circuitBreaker: invalidationCircuitBreaker,
        credentialRejectionIsNeutral: true,
      });
      return result?.deleted ?? 0;
    };

    if (!token || !projectRef) return await deletePattern();
    return await this.coalescePatternDelete(
      JSON.stringify([tokenSource, projectRef, prefixed]),
      cacheCredentialIdentity(token),
      deletePattern,
    );
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
        if (!isCredentialRejection(error)) throw error;
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
