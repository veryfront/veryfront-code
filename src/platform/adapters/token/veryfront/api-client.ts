import { logger as baseLogger } from "#veryfront/utils";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { type VeryfrontTokenConfig } from "./types.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const logger = baseLogger.component("token-storage-api-client");

/** Default timeout for token storage API requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

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

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const { maxRetries, initialDelay, maxDelay } = this.config.retry;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = new Headers(init.headers);
        injectContext(headers);

        const response = await fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }

        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          throw new Error(`Server error: ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isTimeout = error instanceof Error && error.name === "AbortError";
        if (isTimeout) {
          logger.warn("Request timed out", {
            url: url.replace(/token=[^&]+/, "token=***"),
            timeoutMs,
            attempt: attempt + 1,
          });
        }

        if (attempt >= maxRetries) {
          break;
        }

        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        logger.warn("Request failed, retrying...", {
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

    throw TOKEN_STORAGE_ERROR.create({
      detail: `Request failed after ${maxRetries} retries: ${lastError?.message}`,
    });
  }
}
