import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

const log = serverLogger.component("veryfront-api-transport");
const apiClientLog = serverLogger.component("veryfront-api-client");
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TransportRetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface TransportRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  returnText?: boolean;
  expected404?: boolean;
  timeoutMs?: number;
}

export interface VeryfrontApiTransportConfig<T> {
  baseUrl: string;
  getToken: () => string;
  retry: TransportRetryConfig;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  onResponse?: (response: Response, init: TransportRequestInit, url: string) => Promise<T>;
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
  const {
    baseUrl,
    getToken,
    retry: { maxRetries, initialDelay, maxDelay },
    timeoutMs: cfgTimeout = DEFAULT_TIMEOUT_MS,
    defaultHeaders = {},
    afterFetch,
    wrapFetch,
  } = config;
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
    request(pathOrUrl: string, init: TransportRequestInit = {}): Promise<T> {
      const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
      const method = init.method ?? "GET";
      const timeoutMs = init.timeoutMs ?? cfgTimeout;
      // Capture the token once per request: retries of this request must not
      // pick up mid-flight token mutations (setRequestToken/clearRequestToken),
      // matching the pre-transport requestWithRetry semantics.
      const token = getToken();
      return retryWithBackoff(
        (signal, attempt) => {
          const doFetch = async (): Promise<T> => {
            const headers = new Headers(init.headers);
            for (const [k, v] of Object.entries(defaultHeaders)) {
              if (!headers.has(k)) headers.set(k, v);
            }
            headers.set("Authorization", `Bearer ${token}`);
            injectContext(headers);
            const start = performance.now();
            const res = await fetch(url, { method, headers, body: init.body, signal });
            afterFetch?.(res.status, performance.now() - start);
            return onResponse(res, init, url);
          };
          return wrapFetch ? wrapFetch(doFetch, url, method, attempt) : doFetch();
        },
        {
          maxAttempts: maxRetries + 1,
          initialDelay,
          maxDelay,
          timeoutMs,
          shouldRetry,
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
  return createVeryfrontApiTransport<unknown>({
    baseUrl,
    getToken,
    retry,
    defaultHeaders: { "Content-Type": "application/json" },
    afterFetch(status) {
      recordApiRequest(status);
    },
    onRetry({ error, attempt, delay, isTimeout, url, timeoutMs }) {
      if (isTimeout) logTimeout(url, timeoutMs, attempt);
      recordApiRetry();
      apiClientLog.warn("Request failed, retrying...", {
        attempt: attempt + 1,
        maxRetries: retry.maxRetries,
        delay,
        error: error.message,
        timeout: isTimeout,
      });
    },
    wrapFetch(fn, url, method, attempt) {
      const { pathname, host, protocol } = new URL(url);
      return withSpan(SpanNames.HTTP_CLIENT_FETCH, fn, {
        "http.method": method,
        "http.url": url,
        "http.target": pathname,
        "http.host": host,
        "http.scheme": protocol.replace(":", ""),
        "http.retry_attempt": attempt,
      });
    },
  });
}

function logTimeout(url: string, timeoutMs: number, attempt: number): void {
  log.warn("Request timed out", {
    url: url.replace(/token=[^&]+/, "token=***"),
    timeoutMs,
    attempt: attempt + 1,
  });
}

async function defaultOnResponse(
  response: Response,
  init: TransportRequestInit,
  url: string,
): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    const isExpected404 = init.expected404 === true && response.status === 404;
    const level = isExpected404 ? "debug" : response.status >= 500 ? "error" : "warn";
    const redactedUrl = url.replace(/token=[^&]+/g, "token=***");
    apiClientLog[level]("Request failed", {
      url: redactedUrl,
      status: response.status,
      statusText: response.statusText,
      responseText: text.slice(0, 500),
    });
    throw API_CLIENT_ERROR.create({
      detail: `API request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      // Redacted so error telemetry cannot leak token query params.
      context: { details: { url: redactedUrl, responseText: text } },
    });
  }
  return init.returnText ? response.text() : response.json();
}

function defaultShouldRetry(error: unknown): boolean {
  if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return true;
  const { status } = error as VeryfrontError;
  return !status || status < 400 || status >= 500 || status === 429;
}
