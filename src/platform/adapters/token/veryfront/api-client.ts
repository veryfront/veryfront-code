/**
 * Veryfront Token Storage API Client
 *
 * Handles HTTP communication with the Veryfront Cloud token storage API.
 */

import { logger } from "@veryfront/utils";
import { TokenStorageError, type VeryfrontTokenConfig } from "./types.ts";

export class TokenStorageAPIClient {
  private config: VeryfrontTokenConfig;

  constructor(config: VeryfrontTokenConfig) {
    this.config = config;
  }

  /**
   * Get a token by key
   * @returns The encrypted token value, or null if not found
   */
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

      const data = (await response.json()) as { value: string };
      return data.value;
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      logger.error("[TokenStorageAPIClient] Get failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenStorageError(
        `Failed to get token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Set a token by key (upsert)
   */
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

      logger.error("[TokenStorageAPIClient] Set failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenStorageError(
        `Failed to set token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete a token by key (idempotent)
   */
  async delete(key: string): Promise<void> {
    const url = this.buildUrl(key);

    try {
      const response = await this.fetchWithRetry(url, {
        method: "DELETE",
        headers: this.buildHeaders(),
      });

      // 404 is OK for delete (idempotent)
      if (!response.ok && response.status !== 404) {
        throw new TokenStorageError(
          `Failed to delete token: ${response.statusText}`,
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      logger.error("[TokenStorageAPIClient] Delete failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenStorageError(
        `Failed to delete token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all token keys (optional, for admin/debugging)
   */
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

      const data = (await response.json()) as { keys: string[] };
      return data.keys || [];
    } catch (error) {
      if (error instanceof TokenStorageError) {
        throw error;
      }

      logger.error("[TokenStorageAPIClient] List failed", {
        prefix,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenStorageError(
        `Failed to list tokens: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Verify connection to the API
   */
  async ping(): Promise<boolean> {
    try {
      // Try to list tokens (empty result is fine)
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

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const { maxRetries, initialDelay, maxDelay } = this.config.retry;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, init);

        // Don't retry client errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }

        // Retry server errors and rate limits
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          throw new Error(`Server error: ${response.status}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

          logger.warn("[TokenStorageAPIClient] Request failed, retrying...", {
            attempt: attempt + 1,
            maxRetries,
            delay,
            error: lastError.message,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new TokenStorageError(
      `Request failed after ${maxRetries} retries: ${lastError?.message}`,
    );
  }
}
