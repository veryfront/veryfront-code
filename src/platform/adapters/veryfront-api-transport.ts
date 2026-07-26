import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import {
  type BoundedRetryConfig,
  requireVeryfrontApiRetryConfig,
} from "#veryfront/utils/config-resource-limits.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlCredentials, sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

const log = serverLogger.component("veryfront-api-transport");
const apiClientLog = serverLogger.component("veryfront-api-client");
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_VERYFRONT_API_ERROR_BODY_BYTES = 8 * 1024;

interface ValidatedBaseUrl {
  origin: string;
  prefix: string;
}

export type TransportRetryConfig = BoundedRetryConfig;

export interface TransportRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  returnText?: boolean;
  expected404?: boolean;
  timeoutMs?: number;
  /** Caller-owned cancellation signal, composed with the per-attempt timeout. */
  signal?: AbortSignal;
}

export interface VeryfrontApiTransportConfig<T> {
  baseUrl: string;
  getToken: () => string;
  retry: TransportRetryConfig;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  onResponse?: (
    response: Response,
    init: TransportRequestInit,
    url: string,
    signal?: AbortSignal,
  ) => Promise<T>;
  afterFetch?: (status: number, durationMs: number) => void;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: {
    error: Error;
    attempt: number;
    delay: number;
    isTimeout: boolean;
    url: string;
    timeoutMs: number;
  }) => void;
  wrapFinalError?: (lastError: Error, lastAttempt: number) => Error;
  wrapFetch?: (fn: () => Promise<T>, url: string, method: string, attempt: number) => Promise<T>;
}

export interface VeryfrontApiTransport<T> {
  request(pathOrUrl: string, init?: TransportRequestInit): Promise<T>;
}

export function createVeryfrontApiTransport<T>(
  config: VeryfrontApiTransportConfig<T>,
): VeryfrontApiTransport<T> {
  const retry = requireVeryfrontApiRetryConfig(config.retry);
  return createValidatedVeryfrontApiTransport(config, retry, validateBaseUrl(config.baseUrl));
}

function createValidatedVeryfrontApiTransport<T>(
  config: VeryfrontApiTransportConfig<T>,
  retry: TransportRetryConfig,
  validatedBaseUrl: ValidatedBaseUrl,
): VeryfrontApiTransport<T> {
  const {
    getToken,
    timeoutMs: cfgTimeout = DEFAULT_TIMEOUT_MS,
    defaultHeaders = {},
    afterFetch,
    wrapFetch,
  } = config;
  const { maxRetries, initialDelay, maxDelay } = retry;
  const onResponse = config.onResponse ??
    (defaultOnResponse as (r: Response, i: TransportRequestInit, u: string) => Promise<T>);
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry;
  const wrapFinalError = config.wrapFinalError ??
    ((err: Error) =>
      API_CLIENT_ERROR.create({
        detail: `API request failed after ${maxRetries} retries: ${err.message}`,
        cause: err,
        context: { details: { originalError: err } },
      }));
  return {
    async request(
      pathOrUrl: string,
      init: TransportRequestInit = {},
    ): Promise<T> {
      init.signal?.throwIfAborted();
      const url = resolveRequestUrl(validatedBaseUrl, pathOrUrl);
      const method = init.method ?? "GET";
      const timeoutMs = init.timeoutMs ?? cfgTimeout;
      // Capture the token once per request: retries of this request must not
      // pick up mid-flight token mutations (setRequestToken/clearRequestToken),
      // matching the pre-transport requestWithRetry semantics.
      const token = getToken();
      return await retryWithBackoff(
        async (signal, attempt) => {
          const doFetch = async (): Promise<T> => {
            const headers = new Headers(init.headers);
            for (const [k, v] of Object.entries(defaultHeaders)) {
              if (!headers.has(k)) headers.set(k, v);
            }
            headers.set("Authorization", `Bearer ${token}`);
            injectContext(headers);
            const start = performance.now();
            const res = await fetch(url, {
              method,
              headers,
              body: init.body,
              signal,
            });
            afterFetch?.(res.status, performance.now() - start);
            return await onResponse(res, init, url, signal);
          };
          try {
            return await (wrapFetch ? wrapFetch(doFetch, url, method, attempt) : doFetch());
          } catch (error) {
            init.signal?.throwIfAborted();
            throw error;
          }
        },
        {
          abortSignal: init.signal,
          maxAttempts: maxRetries + 1,
          initialDelay,
          maxDelay,
          timeoutMs,
          shouldRetry(error, attempt) {
            return init.signal?.aborted !== true && shouldRetry(error, attempt);
          },
          onRetry: config.onRetry
            ? ({ error, attempt, delay, isTimeout }) =>
              config.onRetry!({ error, attempt, delay, isTimeout, url, timeoutMs })
            : ({ error, attempt, delay, isTimeout }) => {
              if (isTimeout) logTimeout(url, timeoutMs, attempt);
              log.warn("Request failed, retrying...", {
                attempt: attempt + 1,
                maxRetries,
                delay,
                error: error.message,
                timeout: isTimeout,
              });
            },
          wrapFinalError(lastError, lastAttempt) {
            if (lastError.name === "AbortError") logTimeout(url, timeoutMs, lastAttempt);
            return wrapFinalError(lastError, lastAttempt);
          },
        },
      );
    },
  };
}

/** Canonical transport: span tracing, request metrics, API_CLIENT_ERROR mapping. */
export function createCanonicalVeryfrontApiTransport(
  baseUrl: string,
  getToken: () => string,
  retry: TransportRetryConfig,
): VeryfrontApiTransport<unknown> {
  const normalizedRetry = requireVeryfrontApiRetryConfig(retry);
  return createValidatedVeryfrontApiTransport(
    {
      baseUrl,
      getToken,
      retry: normalizedRetry,
      defaultHeaders: { "Content-Type": "application/json" },
      afterFetch(status) {
        recordApiRequest(status);
      },
      onRetry({ error, attempt, delay, isTimeout, url, timeoutMs }) {
        if (isTimeout) logTimeout(url, timeoutMs, attempt);
        recordApiRetry();
        apiClientLog.warn("Request failed, retrying...", {
          attempt: attempt + 1,
          maxRetries: normalizedRetry.maxRetries,
          delay,
          error: error.message,
          timeout: isTimeout,
        });
      },
      wrapFetch(fn, url, method, attempt) {
        const { pathname, host, protocol } = new URL(url);
        return withSpan(SpanNames.HTTP_CLIENT_FETCH, fn, {
          "http.method": method,
          "http.url": sanitizeUrlForSpan(url),
          "http.target": pathname,
          "http.host": host,
          "http.scheme": protocol.replace(":", ""),
          "http.retry_attempt": attempt,
        });
      },
    },
    normalizedRetry,
    validateBaseUrl(baseUrl),
  );
}

function logTimeout(url: string, timeoutMs: number, attempt: number): void {
  log.warn("Request timed out", {
    url: sanitizeUrlCredentials(url),
    timeoutMs,
    attempt: attempt + 1,
  });
}

async function defaultOnResponse(
  response: Response,
  init: TransportRequestInit,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!response.ok) {
    const { text, truncated } = await readResponseTextPrefix(
      response,
      MAX_VERYFRONT_API_ERROR_BODY_BYTES,
      signal,
    );
    const isExpected404 = init.expected404 === true && response.status === 404;
    const level = isExpected404 ? "debug" : response.status >= 500 ? "error" : "warn";
    const redactedUrl = sanitizeUrlCredentials(url);
    apiClientLog[level]("Request failed", {
      url: redactedUrl,
      status: response.status,
      statusText: response.statusText,
      responseText: text.slice(0, 500),
      responseTruncated: truncated,
    });
    throw API_CLIENT_ERROR.create({
      detail: `API request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      // Redacted so error telemetry cannot leak token query params.
      context: {
        details: {
          url: redactedUrl,
          responseText: text,
          responseTruncated: truncated,
        },
      },
    });
  }
  return init.returnText ? response.text() : response.json();
}

function defaultShouldRetry(error: unknown): boolean {
  if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return true;
  const { status } = error as VeryfrontError;
  return !status || status < 400 || status >= 500 || status === 429;
}

function validateBaseUrl(value: string): ValidatedBaseUrl {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Veryfront API base URL must be a non-empty absolute URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError("Veryfront API base URL must be a valid absolute URL", {
      cause,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Veryfront API base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError("Veryfront API base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new TypeError("Veryfront API base URL must not contain a query or fragment");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return {
    origin: url.origin,
    prefix: `${url.origin}${pathname}`,
  };
}

function resolveRequestUrl(baseUrl: ValidatedBaseUrl, pathOrUrl: string): string {
  if (typeof pathOrUrl !== "string") {
    throw new TypeError("Veryfront API request URL must be a string");
  }
  if (pathOrUrl.startsWith("//")) {
    throw new TypeError("Veryfront API request URL must not use a protocol-relative origin");
  }

  let absolute: URL | undefined;
  try {
    absolute = new URL(pathOrUrl);
  } catch {
    // Relative API paths are resolved below.
  }

  if (absolute) {
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      throw new TypeError("Veryfront API request URL must use http or https");
    }
    if (absolute.username || absolute.password) {
      throw new TypeError("Veryfront API request URL must not contain credentials");
    }
    if (absolute.origin !== baseUrl.origin) {
      throw new TypeError("Veryfront API request origin must match the configured API origin");
    }
    return absolute.href;
  }

  const separator = pathOrUrl.startsWith("/") || pathOrUrl.startsWith("?") ? "" : "/";
  const resolved = new URL(`${baseUrl.prefix}${separator}${pathOrUrl}`);
  if (resolved.origin !== baseUrl.origin) {
    throw new TypeError("Veryfront API request origin must match the configured API origin");
  }
  return resolved.href;
}
