import { logger } from "#veryfront/utils";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { TokenStorageError, type VeryfrontTokenConfig } from "./types.ts";

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

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const { maxRetries, initialDelay, maxDelay } = this.config.retry;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers = new Headers(init.headers);
        injectContext(headers);

        const response = await fetch(url, { ...init, headers });

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }

        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          throw new Error(`Server error: ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt >= maxRetries) {
          break;
        }

        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        logger.warn("[TokenStorageAPIClient] Request failed, retrying...", {
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: lastError.message,
        });

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new TokenStorageError(
      `Request failed after ${maxRetries} retries: ${lastError?.message}`,
    );
  }
}
