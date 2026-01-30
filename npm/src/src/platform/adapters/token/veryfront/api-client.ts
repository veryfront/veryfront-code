import * as dntShim from "../../../../../_dnt.shims.js";
import { logger } from "../../../../utils/index.js";
import { injectContext } from "../../../../observability/tracing/otlp-setup.js";
import { TokenStorageError, type VeryfrontTokenConfig } from "./types.js";

/** Default timeout for token storage API requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class TokenStorageAPIClient {
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
        throw new TokenStorageError(
          `Failed to get token: ${response.statusText}`,
          response.status,
        );
      }

      const data: { value: string } = await response.json();
      return data.value;
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      logger.error("[TokenStorageAPIClient] Get failed", { key, error: message });

      throw new TokenStorageError(`Failed to get token: ${message}`);
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
        throw new TokenStorageError(
          `Failed to set token: ${response.statusText}`,
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      logger.error("[TokenStorageAPIClient] Set failed", { key, error: message });

      throw new TokenStorageError(`Failed to set token: ${message}`);
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

      throw new TokenStorageError(
        `Failed to delete token: ${response.statusText}`,
        response.status,
      );
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      logger.error("[TokenStorageAPIClient] Delete failed", {
        key,
        error: message,
      });

      throw new TokenStorageError(`Failed to delete token: ${message}`);
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
        throw new TokenStorageError(
          `Failed to list tokens: ${response.statusText}`,
          response.status,
        );
      }

      const data: { keys?: string[] } = await response.json();
      return data.keys ?? [];
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      logger.error("[TokenStorageAPIClient] List failed", {
        prefix,
        error: message,
      });

      throw new TokenStorageError(`Failed to list tokens: ${message}`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.list();
      return true;
    } catch {
      return false;
    }
  }

  private buildUrl(key: string): string {
    return `${this.config.apiBaseUrl}/v1/projects/${
      encodeURIComponent(this.config.projectSlug)
    }/tokens/${encodeURIComponent(key)}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      Accept: "application/json",
    };
  }

  private async fetchWithRetry(url: string, init: dntShim.RequestInit): Promise<dntShim.Response> {
    const { maxRetries, initialDelay, maxDelay } = this.config.retry;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = dntShim.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = new dntShim.Headers(init.headers);
        injectContext(headers);

        const response = await dntShim.fetch(url, { ...init, headers, signal: controller.signal });

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }

        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          throw new Error(`Server error: ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this was a timeout
        const isTimeout = error instanceof Error && error.name === "AbortError";
        if (isTimeout) {
          logger.warn("[TokenStorageAPIClient] Request timed out", {
            url: url.replace(/token=[^&]+/, "token=***"),
            timeoutMs,
            attempt: attempt + 1,
          });
        }

        if (attempt >= maxRetries) {
          break;
        }

        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        logger.warn("[TokenStorageAPIClient] Request failed, retrying...", {
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: lastError.message,
          timeout: isTimeout,
        });

        await new Promise<void>((resolve) => dntShim.setTimeout(resolve, delay));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new TokenStorageError(
      `Request failed after ${maxRetries} retries: ${lastError?.message}`,
    );
  }
}
