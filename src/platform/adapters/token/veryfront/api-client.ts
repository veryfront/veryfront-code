import { logger as baseLogger } from "#veryfront/utils";
import { type VeryfrontTokenConfig } from "./types.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  createVeryfrontApiTransport,
  type VeryfrontApiTransport,
} from "../../veryfront-api-transport.ts";

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
  private transport: VeryfrontApiTransport<Response>;

  constructor(config: VeryfrontTokenConfig) {
    this.config = config;

    const { maxRetries, initialDelay, maxDelay } = config.retry;
    const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    this.transport = createVeryfrontApiTransport<Response>({
      baseUrl: config.apiBaseUrl,
      getToken: () => config.apiToken,
      retry: { maxRetries, initialDelay, maxDelay },
      timeoutMs,
      defaultHeaders: { "Accept": "application/json" },

      onResponse: async (response) => {
        // 4xx non-429: pass the response through so callers handle it.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }
        // 5xx / 429: throw to trigger retry logic. Cancel the body first so
        // retries do not hold connections/buffers open.
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          await cancelResponseBody(response, "retry");
          throw TOKEN_STORAGE_ERROR.create({
            detail: `Server error: ${response.status}`,
            status: response.status,
          });
        }
        return response;
      },

      wrapFinalError: (lastError) =>
        TOKEN_STORAGE_ERROR.create({
          detail: `Request failed after ${maxRetries} retries: ${lastError.message}`,
        }),
    });
  }

  async get(key: string): Promise<string | null> {
    const url = this.buildUrl(key);

    try {
      const response = await this.transport.request(url);

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
      const response = await this.transport.request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      const response = await this.transport.request(url, { method: "DELETE" });

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
      const response = await this.transport.request(url.toString());

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
}
