import { logger } from "#veryfront/utils";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { recordApiRequest, recordApiRetry } from "#veryfront/observability/simple-metrics/index.ts";
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
  const { maxRetries, initialDelay, maxDelay } = retryConfig;

  // Note: We only trace the individual fetch attempts (HTTP_CLIENT_FETCH),
  // not the outer retry wrapper, to reduce span nesting and trace size.
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

          const response = await fetch(url, { headers });
          const duration = performance.now() - startTime;

          recordApiRequest(response.status);

          logger.debug("[API] Request completed", {
            path: urlPath,
            status: response.status,
            durationMs: Math.round(duration),
          });

          if (!response.ok) {
            const text = await response.text();

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

      if (error instanceof VeryfrontAPIError) {
        const status = error.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
      }

      if (attempt >= maxRetries) {
        break;
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      recordApiRetry();

      logger.warn("[VeryfrontAPIClient] Request failed, retrying...", {
        attempt: attempt + 1,
        maxRetries,
        delay,
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new VeryfrontAPIError(
    `API request failed after ${maxRetries} retries: ${lastError?.message}`,
    undefined,
    { originalError: lastError },
  );
}
