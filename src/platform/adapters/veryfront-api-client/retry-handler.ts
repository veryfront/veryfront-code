import { logger } from "@veryfront/utils";
import { VeryfrontAPIError } from "./types.ts";

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface RequestOptions {
  returnText?: boolean;
}

export async function requestWithRetry<T>(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<T> {
  let lastError: Error | null = null;

  const { maxRetries, initialDelay, maxDelay } = retryConfig;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new VeryfrontAPIError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          { url, responseText: text },
        );
      }

      if (options.returnText) {
        return (await response.text()) as T;
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (
        error instanceof VeryfrontAPIError && error.status && error.status >= 400 &&
        error.status < 500
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
}
