import { logger } from "#veryfront/utils";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VeryfrontAPIError } from "./types.ts";

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface RequestOptions {
  returnText?: boolean;
}

export async function requestWithRetry(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<unknown> {
  const urlObj = new URL(url);
  const urlPath = urlObj.pathname;

  // Wrap entire request in a span for tracing
  return await withSpan("api.request", async () => {
    let lastError: Error | null = null;
    const { maxRetries, initialDelay, maxDelay } = retryConfig;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        const headers = new Headers({
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        });
        injectContext(headers); // Propagate trace context to API

        const response = await fetch(url, { headers });
        const duration = performance.now() - startTime;

        // Log API timing for performance analysis
        logger.debug("[API] Request completed", {
          path: urlPath,
          status: response.status,
          durationMs: Math.round(duration),
        });

        if (!response.ok) {
          const text = await response.text();
          // Log detailed error info for debugging
          logger.error("[VeryfrontAPIClient] Request failed", {
            url: url.replace(/token=[^&]+/, "token=***"),
            status: response.status,
            statusText: response.statusText,
            responseText: text.slice(0, 500),
          });
          throw new VeryfrontAPIError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status,
            { url, responseText: text },
          );
        }

        if (options.returnText) {
          return await response.text();
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry most 4xx errors (client errors), but DO retry:
        // - 401: Can be transient rate limiting from concurrent requests
        // - 429: Explicit rate limiting
        if (
          error instanceof VeryfrontAPIError && error.status &&
          error.status >= 400 &&
          error.status < 500 && error.status !== 401 && error.status !== 429
        ) {
          throw error;
        }

        if (attempt < maxRetries) {
          const delay = Math.min(
            initialDelay * Math.pow(2, attempt),
            maxDelay,
          );

          logger.warn("[VeryfrontAPIClient] Request failed, retrying...", {
            attempt: attempt + 1,
            maxRetries,
            delay,
            error: lastError.message,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new VeryfrontAPIError(
      `API request failed after ${maxRetries} retries: ${lastError?.message}`,
      undefined,
      { originalError: lastError },
    );
  }, {
    "http.url": urlPath,
    "http.method": "GET",
  });
}
