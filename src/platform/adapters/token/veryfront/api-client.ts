import { logger as baseLogger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  assertTokenStorageKey,
  assertTokenStoragePrefix,
  assertTokenStorageValue,
  type VeryfrontTokenConfig,
} from "./types.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  createVeryfrontApiTransport,
  type VeryfrontApiTransport,
} from "../../veryfront-api-transport.ts";

const logger = baseLogger.component("token-storage-api-client");
const MAX_TOKEN_STORAGE_RESPONSE_BODY_BYTES = 1024 * 1024;

interface TokenStorageHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
}

function cancelResponseBody(response: Response, operation: string): void {
  if (!response.body) return;

  try {
    void response.body.cancel().catch((error) => {
      logger.debug("Response body cancellation failed during token storage cleanup", {
        operation,
        status: response.status,
        error,
      });
    });
  } catch (error) {
    logger.debug("Response body cancellation failed during token storage cleanup", {
      operation,
      status: response.status,
      error,
    });
  }
}

export class TokenStorageApiClient {
  private readonly config: VeryfrontTokenConfig;
  private readonly transport: VeryfrontApiTransport<TokenStorageHttpResponse>;

  constructor(config: VeryfrontTokenConfig) {
    this.config = config;

    const { maxRetries, initialDelay, maxDelay } = config.retry;

    this.transport = createVeryfrontApiTransport<TokenStorageHttpResponse>({
      baseUrl: config.apiBaseUrl,
      getToken: () => config.apiToken,
      retry: { maxRetries, initialDelay, maxDelay },
      timeoutMs: config.timeoutMs,
      defaultHeaders: { "Accept": "application/json" },
      // Always use the framework's captured host transport. In local dev this
      // client can carry a host-private stored login token after project code
      // has run in the same realm and replaced globalThis.fetch.
      outboundPolicy: {},

      onResponse: async (response, _init, _url, signal) => {
        // 5xx / 429: throw to trigger retry logic. Cancel the body first so
        // retries do not hold connections/buffers open.
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          cancelResponseBody(response, "retry");
          throw TOKEN_STORAGE_ERROR.create({
            detail: `Server error: ${response.status}`,
            status: response.status,
          });
        }

        const { text, truncated } = await readResponseTextPrefix(
          response,
          MAX_TOKEN_STORAGE_RESPONSE_BODY_BYTES,
          signal,
        );
        if (truncated) {
          throw TOKEN_STORAGE_ERROR.create({
            detail:
              `Token storage response body exceeds ${MAX_TOKEN_STORAGE_RESPONSE_BODY_BYTES} bytes`,
            status: 502,
          });
        }
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyText: text,
        };
      },

      wrapFinalError: (lastError) =>
        TOKEN_STORAGE_ERROR.create({
          detail: `Request failed after ${maxRetries} retries: ${lastError.message}`,
        }),
    });
  }

  async get(key: string): Promise<string | null> {
    assertTokenStorageKey(key);
    const url = this.buildUrl(key);

    try {
      const response = await this.transport.request(url);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw TOKEN_STORAGE_ERROR.create({
          detail: `Failed to get token: ${response.statusText}`,
          status: response.status,
        });
      }

      const data = this.parseJsonBody(response, "get");
      if (!isRecord(data) || typeof data.value !== "string") {
        throw TOKEN_STORAGE_ERROR.create({
          detail: "Malformed get response: expected an object with a string value",
          status: 502,
        });
      }
      return data.value;
    } catch (error) {
      throw this.wrapError(error, "Get", key, `Failed to get token`);
    }
  }

  async set(key: string, value: string): Promise<void> {
    assertTokenStorageKey(key);
    assertTokenStorageValue(value);
    const url = this.buildUrl(key);

    try {
      const response = await this.transport.request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
    assertTokenStorageKey(key);
    const url = this.buildUrl(key);

    try {
      const response = await this.transport.request(url, { method: "DELETE" });

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

  async list(prefix?: string, signal?: AbortSignal): Promise<string[]> {
    assertTokenStoragePrefix(prefix);
    let url = `/v1/projects/${encodeURIComponent(this.config.projectSlug)}/tokens`;

    if (prefix !== undefined && prefix.length > 0) {
      const search = new URLSearchParams({ prefix });
      url += `?${search.toString()}`;
    }

    try {
      const response = await this.transport.request(url, { signal });

      if (!response.ok) {
        throw TOKEN_STORAGE_ERROR.create({
          detail: `Failed to list tokens: ${response.statusText}`,
          status: response.status,
        });
      }

      const data = this.parseJsonBody(response, "list");
      if (
        !isRecord(data) ||
        (data.keys !== undefined &&
          (!Array.isArray(data.keys) ||
            !data.keys.every((key: unknown) => typeof key === "string")))
      ) {
        throw TOKEN_STORAGE_ERROR.create({
          detail: "Malformed list response: expected an object with a string keys array",
          status: 502,
        });
      }
      return data.keys ?? [];
    } catch (error) {
      signal?.throwIfAborted();
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

  async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.list(undefined, signal);
      return true;
    } catch {
      signal?.throwIfAborted();
      /* expected: ping returns false when API is unreachable */
      return false;
    }
  }

  private buildUrl(key: string): string {
    return `/v1/projects/${encodeURIComponent(this.config.projectSlug)}/tokens/${
      encodeURIComponent(key)
    }`;
  }

  private parseJsonBody(response: TokenStorageHttpResponse, operation: string): unknown {
    try {
      return JSON.parse(response.bodyText);
    } catch (cause) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: `Malformed ${operation} response: expected valid JSON`,
        cause,
        status: 502,
      });
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
