import { logger } from "#veryfront/utils";
import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import { API_CLIENT_ERROR, VeryfrontError } from "./types.ts";

const apiLog = logger.component("api");
const veryfrontApiClientLog = logger.component("veryfront-api-client");

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface RequestOptions {
  returnText?: boolean;
  /** Request timeout in milliseconds. Defaults to 30000ms (30 seconds). */
  timeoutMs?: number;
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  /** Demote an expected 404 miss to debug while preserving thrown error semantics. */
  expected404?: boolean;
}

/** Default timeout for API requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function logTimedOut(url: string, timeoutMs: number, attempt: number): void {
  veryfrontApiClientLog.warn("Request timed out", {
    url: url.replace(/token=[^&]+/, "token=***"),
    timeoutMs,
    attempt: attempt + 1,
  });
}

export async function requestWithRetry(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<unknown> {
  const urlObj = new URL(url);
  const urlPath = urlObj.pathname;
  const { maxRetries, initialDelay, maxDelay } = retryConfig;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // Note: We only trace the individual fetch attempts (HTTP_CLIENT_FETCH),
  // not the outer retry wrapper, to reduce span nesting and trace size.
  const result = await retryWithBackoff(
    (signal, attempt) => {
      return withSpan(
        SpanNames.HTTP_CLIENT_FETCH,
        async () => {
          const startTime = performance.now();

          const headers = new Headers(options.headers);
          headers.set("Authorization", `Bearer ${apiToken}`);
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
          }
          injectContext(headers);

          const response = await fetch(url, {
            method: options.method ?? "GET",
            headers,
            body: options.body,
            signal,
          });
          const duration = performance.now() - startTime;

          recordApiRequest(response.status);

          apiLog.debug("Request completed", {
            path: urlPath,
            status: response.status,
            durationMs: Math.round(duration),
          });

          if (!response.ok) {
            const text = await response.text();

            // Optional probes (for example stylesheet candidates) may expect a 404.
            // Keep only explicit opt-ins below warn while preserving thrown error semantics.
            const isExpected404 = options.expected404 === true && response.status === 404;
            // 4xx = client errors (expected, e.g. 404 for missing deno.json) → warn
            // 5xx = server errors (unexpected) → error
            const logLevel = isExpected404 ? "debug" : response.status >= 500 ? "error" : "warn";
            veryfrontApiClientLog[logLevel]("Request failed", {
              url: url.replace(/token=[^&]+/, "token=***"),
              status: response.status,
              statusText: response.statusText,
              responseText: text.slice(0, 500),
            });

            throw API_CLIENT_ERROR.create({
              detail: `API request failed: ${response.status} ${response.statusText}`,
              status: response.status,
              context: { details: { url, responseText: text } },
            });
          }

          const data = options.returnText ? await response.text() : await response.json();
          return { data, status: response.status, duration };
        },
        {
          "http.method": options.method ?? "GET",
          "http.url": url,
          "http.target": urlPath,
          "http.host": urlObj.host,
          "http.scheme": urlObj.protocol.replace(":", ""),
          "http.retry_attempt": attempt,
        },
      );
    },
    {
      maxAttempts: maxRetries + 1,
      initialDelay,
      maxDelay,
      timeoutMs,
      shouldRetry: (error) => {
        if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return true;
        const status = error.status;
        return !status || status < 400 || status >= 500 || status === 429;
      },
      onRetry: ({ error, attempt, delay, isTimeout }) => {
        if (isTimeout) logTimedOut(url, timeoutMs, attempt);

        recordApiRetry();

        veryfrontApiClientLog.warn("Request failed, retrying...", {
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: error.message,
          timeout: isTimeout,
        });
      },
      wrapFinalError: (lastError, lastAttempt) => {
        if (lastError.name === "AbortError") logTimedOut(url, timeoutMs, lastAttempt);

        return API_CLIENT_ERROR.create({
          detail: `API request failed after ${maxRetries} retries: ${lastError.message}`,
          cause: lastError,
          context: { details: { originalError: lastError } },
        });
      },
    },
  );

  return result.data;
}
