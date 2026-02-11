import { logger } from "#veryfront/utils";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { recordApiRequest, recordApiRetry } from "#veryfront/observability/simple-metrics/index.ts";
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
}

/** Default timeout for API requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

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
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await withSpan(
        SpanNames.HTTP_CLIENT_FETCH,
        async () => {
          const startTime = performance.now();

          const headers = new Headers({
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          });
          injectContext(headers);

          const response = await fetch(url, { headers, signal: controller.signal });
          const duration = performance.now() - startTime;

          recordApiRequest(response.status);

          apiLog.debug("Request completed", {
            path: urlPath,
            status: response.status,
            durationMs: Math.round(duration),
          });

          if (!response.ok) {
            const text = await response.text();

            veryfrontApiClientLog.error("Request failed", {
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
          "http.method": "GET",
          "http.url": url,
          "http.target": urlPath,
          "http.host": urlObj.host,
          "http.scheme": urlObj.protocol.replace(":", ""),
          "http.retry_attempt": attempt,
        },
      );

      return result.data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isTimeout = lastError.name === "AbortError";
      if (isTimeout) {
        veryfrontApiClientLog.warn("Request timed out", {
          url: url.replace(/token=[^&]+/, "token=***"),
          timeoutMs,
          attempt: attempt + 1,
        });
      }

      if (error instanceof VeryfrontError && error.slug === "api-client-error") {
        const status = error.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
      }

      if (attempt >= maxRetries) {
        break;
      }

      const delay = Math.min(initialDelay * 2 ** attempt, maxDelay);

      recordApiRetry();

      veryfrontApiClientLog.warn("Request failed, retrying...", {
        attempt: attempt + 1,
        maxRetries,
        delay,
        error: lastError.message,
        timeout: isTimeout,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw API_CLIENT_ERROR.create({
    detail: `API request failed after ${maxRetries} retries: ${lastError?.message}`,
    cause: lastError ?? undefined,
    context: { details: { originalError: lastError } },
  });
}
