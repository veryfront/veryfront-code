import { logger as baseLogger } from "#veryfront/utils";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { type VeryfrontTokenConfig } from "./types.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";

const logger = baseLogger.component("token-storage-api-client");

/** Default timeout for token storage API requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

async function cancelResponseBody(response: Response, operation: string): Promise<void> {
  if (!response.body) return;

  try {
    await response.body.cancel();
  } catch (error) {
    logger.debug("Response body cancellation failed during token storage cleanup", {
      operation,
      status: response.status,
      error,
    });
  }
}

export class TokenStorageApiClient {
  private config: VeryfrontTokenConfig;

  constructor(config: VeryfrontTokenConfig) {
    this.config = config;
  }

  async get(key: string): Promise<string | null> {
    const url = this.buildUrl(key);

    try {
      const response = await this.fetchWithRetry(url, {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        await cancelResponseBody(response, "get");
        throw TOKEN_STORAGE_ERROR.create({
          detail: `Failed to get token: ${response.statusText}`,
          status: response.status,
        });
      }

      const data: { value: string } = await response.json();
      return data.value;
    } catch (error) {
      throw this.wrapError(error, "Get", key, `Failed to get token`);
    }
  }

  async set(key: string, value: string): Promise<void> {
    const url = this.buildUrl(key);

    try {
      const response = await this.fetchWithRetry(url, {
        method: "PUT",
        headers: {
          ...this.buildHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
      });

      if (!response.ok) {
        await cancelResponseBody(response, "set");
        throw TOKEN_STORAGE_ERROR.create({
          detail: `Failed to set token: ${response.statusText}`,
          status: response.status,
        });
      }
    } catch (error) {
      throw this.wrapError(error, "Set", key, `Failed to set token`);
    }
  }

  async delete(key: string): Promise<void> {
    const url = this.buildUrl(key);

    try {
      const response = await this.fetchWithRetry(url, {
        method: "DELETE",
        headers: this.buildHeaders(),
      });

      if (response.ok || response.status === 404) {
        return;
      }

      await cancelResponseBody(response, "delete");
      throw TOKEN_STORAGE_ERROR.create({
        detail: `Failed to delete token: ${response.statusText}`,
        status: response.status,
      });
    } catch (error) {
      throw this.wrapError(error, "Delete", key, `Failed to delete token`);
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const url = new URL(
      `/v1/projects/${encodeURIComponent(this.config.projectSlug)}/tokens`,
      this.config.apiBaseUrl,
    );

    if (prefix) {
      url.searchParams.set("prefix", prefix);
    }

    try {
      const response = await this.fetchWithRetry(url.toString(), {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        await cancelResponseBody(response, "list");
        throw TOKEN_STORAGE_ERROR.create({
          detail: `Failed to list tokens: ${response.statusText}`,
          status: response.status,
        });
      }

      const data: { keys?: string[] } = await response.json();
      return data.keys ?? [];
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "token-storage-error") {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      logger.error("List failed", {
        prefix,
        error: message,
      });

      throw TOKEN_STORAGE_ERROR.create({ detail: `Failed to list tokens: ${message}` });
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.list();
      return true;
    } catch (_) {
      /* expected: ping returns false when API is unreachable */
      return false;
    }
  }

  private buildUrl(key: string): string {
    return `${this.config.apiBaseUrl}/v1/projects/${
      encodeURIComponent(
        this.config.projectSlug,
      )
    }/tokens/${encodeURIComponent(key)}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      Accept: "application/json",
    };
  }

  private wrapError(
    error: unknown,
    action: "Get" | "Set" | "Delete",
    key: string,
    prefixMessage: string,
  ): VeryfrontError {
    if (error instanceof VeryfrontError && error.slug === "token-storage-error") {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);

    logger.error(`${action} failed`, { key, error: message });

    return TOKEN_STORAGE_ERROR.create({ detail: `${prefixMessage}: ${message}` });
  }

  private logTimedOut(url: string, timeoutMs: number, attempt: number): void {
    logger.warn("Request timed out", {
      url: url.replace(/token=[^&]+/, "token=***"),
      timeoutMs,
      attempt: attempt + 1,
    });
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const { maxRetries, initialDelay, maxDelay } = this.config.retry;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return retryWithBackoff(
      (signal) => {
        const headers = new Headers(init.headers);
        injectContext(headers);

        return fetch(url, { ...init, headers, signal }).then((response) => {
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return response;
          }

          if (!response.ok && (response.status >= 500 || response.status === 429)) {
            throw TOKEN_STORAGE_ERROR.create({
              detail: `Server error: ${response.status}`,
              status: response.status,
            });
          }

          return response;
        });
      },
      {
        maxAttempts: maxRetries + 1,
        initialDelay,
        maxDelay,
        timeoutMs,
        onRetry: ({ error, attempt, delay, isTimeout }) => {
          if (isTimeout) this.logTimedOut(url, timeoutMs, attempt);

          logger.warn("Request failed, retrying...", {
            attempt: attempt + 1,
            maxRetries,
            delay,
            error: error.message,
            timeout: isTimeout,
          });
        },
        wrapFinalError: (lastError, lastAttempt) => {
          if (lastError.name === "AbortError") this.logTimedOut(url, timeoutMs, lastAttempt);

          return TOKEN_STORAGE_ERROR.create({
            detail: `Request failed after ${maxRetries} retries: ${lastError.message}`,
          });
        },
      },
    );
  }
}
