import { createError, retryWithBackoff, toError } from "#veryfront/errors";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry/config.ts";
import { logger } from "#veryfront/utils";
import type { ResolvedGitHubConfig } from "./types.ts";
import {
  getGitHubBlobResponseSchema,
  getGitHubContentsResponseSchema,
  getGitHubTreeResponseSchema,
  type GitHubBlobResponse,
  type GitHubContentItem,
  type GitHubTreeResponse,
} from "./schemas/index.ts";

const LOG_PREFIX = "[GitHubApiClient]";

const RATE_LIMIT_WARNING_THRESHOLD = 100;
const RETRY_JITTER_MAX_MS = 1_000;
const MAX_REPOSITORY_SEGMENT_LENGTH = 256;
const MAX_ENDPOINT_VALUE_LENGTH = 4_096;

function encodeRepositorySegment(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REPOSITORY_SEGMENT_LENGTH ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`GitHub ${label} must be a bounded canonical path segment`);
  }

  let decoded = value;
  for (let depth = 0; depth <= value.length; depth++) {
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.trim() !== decoded ||
      /\p{Cc}/u.test(decoded)
    ) {
      throw new TypeError(`GitHub ${label} must be a single non-traversal path segment`);
    }

    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new TypeError(`GitHub ${label} contains malformed percent-encoding`);
    }
    if (next === decoded) return encodeURIComponent(value);
    decoded = next;
  }

  throw new TypeError(`GitHub ${label} contains excessive percent-encoding`);
}

function encodeEndpointValue(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_VALUE_LENGTH ||
    value === "." ||
    value === ".." ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`GitHub ${label} must be bounded non-empty text`);
  }
  return encodeURIComponent(value);
}

function encodeContentsPath(path: string): { normalized: string; encoded: string } {
  if (
    typeof path !== "string" ||
    path.length > MAX_ENDPOINT_VALUE_LENGTH ||
    /\p{Cc}/u.test(path)
  ) {
    throw new TypeError("GitHub contents path must be bounded text without control characters");
  }
  const normalized = path.replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("GitHub contents path must not contain traversal segments");
  }
  return {
    normalized,
    encoded: segments.map(encodeURIComponent).join("/"),
  };
}

class GitHubBlobIntegrityError extends Error {}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

type APIError = Error & { statusCode?: number; endpoint?: string; repo?: string };

export class GitHubApiClient {
  private readonly baseUrl = "https://api.github.com";
  private readonly repositoryEndpoint: string;
  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(private readonly config: ResolvedGitHubConfig) {
    // Invalid repository identity remains a CONFIG-category boundary error.
    try {
      const owner = encodeRepositorySegment(config.owner, "owner");
      const repo = encodeRepositorySegment(config.repo, "repository");
      this.repositoryEndpoint = `/repos/${owner}/${repo}`;
    } catch (cause) {
      throw CONFIG_VALIDATION_FAILED.create({
        detail: cause instanceof Error ? cause.message : "GitHub repository identity is invalid",
        cause,
      });
    }
  }

  get repoId(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  async getTree(ref?: string): Promise<GitHubTreeResponse> {
    const treeRef = ref ?? this.config.ref;
    const endpoint = `${this.repositoryEndpoint}/git/trees/${
      encodeEndpointValue(treeRef, "tree ref")
    }?recursive=1`;

    logger.debug(`${LOG_PREFIX} Fetching tree`, { ref: treeRef });

    const raw = await this.request(endpoint);
    const response = getGitHubTreeResponseSchema().parse(raw);

    if (response.truncated) {
      logger.warn(
        `${LOG_PREFIX} Repository tree is truncated. Large repos may have incomplete file listing.`,
      );
    }

    return response;
  }

  async getContents(
    path: string,
    ref?: string,
  ): Promise<GitHubContentItem | GitHubContentItem[]> {
    const contentRef = ref ?? this.config.ref;
    const { normalized, encoded } = encodeContentsPath(path);
    const endpoint = `${this.repositoryEndpoint}/contents/${encoded}?ref=${
      encodeEndpointValue(contentRef, "contents ref")
    }`;

    logger.debug(`${LOG_PREFIX} Fetching contents`, { path: normalized });

    const raw = await this.request(endpoint);
    return getGitHubContentsResponseSchema().parse(raw);
  }

  async getBlob(sha: string): Promise<GitHubBlobResponse> {
    const endpoint = `${this.repositoryEndpoint}/git/blobs/${encodeEndpointValue(sha, "blob SHA")}`;

    logger.debug(`${LOG_PREFIX} Fetching blob`, { sha });

    const raw = await this.request(endpoint);
    return getGitHubBlobResponseSchema().parse(raw);
  }

  async getBlobBytesWithinLimit(
    sha: string,
    expectedSize: number,
    byteLimit: number,
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize < 0 ||
      !Number.isSafeInteger(byteLimit) ||
      byteLimit <= 0
    ) {
      throw new RangeError("GitHub bounded blob sizes must be safe non-negative integers");
    }
    if (expectedSize > byteLimit) {
      throw new RangeError(`GitHub blob exceeds ${byteLimit} bytes`);
    }
    const endpoint = `${this.repositoryEndpoint}/git/blobs/${encodeEndpointValue(sha, "blob SHA")}`;

    logger.debug(`${LOG_PREFIX} Fetching bounded raw blob`, { sha, expectedSize });

    return await retryWithBackoff(
      async () => {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          headers: this.requestHeaders("application/vnd.github.raw+json"),
        });
        this.updateRateLimitInfo(response);
        if (!response.ok) {
          await response.body?.cancel();
          throw this.createAPIError(response.status, "", endpoint);
        }
        return await this.readExactResponseBytes(response, expectedSize, byteLimit);
      },
      {
        maxAttempts: this.config.retry.maxRetries,
        initialDelay: this.config.retry.initialDelay,
        maxDelay: this.config.retry.maxDelay,
        shouldRetry: (error) => {
          if (error instanceof GitHubBlobIntegrityError) return false;
          const err = error instanceof Error ? error : new Error(String(error));
          return !(this.isClientError(err) && !this.isRateLimitError(err));
        },
        computeDelay: (attempt, error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          return this.calculateRetryDelay(attempt + 1, err);
        },
      },
    );
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  private request(endpoint: string): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;

    return retryWithBackoff(
      async () => {
        const response = await fetch(url, {
          headers: this.requestHeaders("application/vnd.github.v3+json"),
        });

        this.updateRateLimitInfo(response);

        if (!response.ok) {
          const errorBody = await response.text();
          throw this.createAPIError(response.status, errorBody, endpoint);
        }

        return response.json();
      },
      {
        // This client's config.retry.maxRetries has always meant TOTAL attempts
        // (the old loop ran `attempt = 1..maxRetries`), unlike the veryfront-api
        // clients where maxRetries means retries after the first try.
        maxAttempts: this.config.retry.maxRetries,
        initialDelay: this.config.retry.initialDelay,
        maxDelay: this.config.retry.maxDelay,
        shouldRetry: (error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          return !(this.isClientError(err) && !this.isRateLimitError(err));
        },
        computeDelay: (attempt, error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          return this.calculateRetryDelay(attempt + 1, err);
        },
        onRetry: ({ error, attempt, delay }) => {
          logger.warn(`${LOG_PREFIX} Request failed, retrying`, {
            attempt: attempt + 1,
            delay,
            error: error.message,
          });
        },
      },
    );
  }

  private requestHeaders(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: accept,
      "User-Agent": "veryfront-server",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async readExactResponseBytes(
    response: Response,
    expectedSize: number,
    byteLimit: number,
  ): Promise<Uint8Array> {
    const declaredLength = response.headers.get("Content-Length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > byteLimit) {
        await response.body?.cancel();
        throw new GitHubBlobIntegrityError(
          `GitHub raw blob exceeds ${byteLimit} bytes before streaming`,
        );
      }
    }
    const body = response.body;
    if (body === null) {
      if (expectedSize === 0) return new Uint8Array();
      throw new GitHubBlobIntegrityError("GitHub raw blob response has no body");
    }

    const bytes = new Uint8Array(expectedSize);
    const reader = body.getReader();
    let offset = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) {
          throw new GitHubBlobIntegrityError("GitHub raw blob returned a non-byte chunk");
        }
        if (result.value.byteLength > expectedSize - offset) {
          throw new GitHubBlobIntegrityError(
            `GitHub raw blob does not match its admitted ${expectedSize}-byte tree entry`,
          );
        }
        bytes.set(result.value, offset);
        offset += result.value.byteLength;
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch (cancelError) {
        throw new AggregateError(
          [error, cancelError],
          "GitHub raw blob read and cancellation both failed",
        );
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (offset !== expectedSize) {
      throw new GitHubBlobIntegrityError(
        `GitHub raw blob does not match its admitted ${expectedSize}-byte tree entry`,
      );
    }
    return bytes;
  }

  private updateRateLimitInfo(response: Response): void {
    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const used = response.headers.get("X-RateLimit-Used");

    if (!limit || !remaining || !reset) return;

    this.rateLimitInfo = {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      reset: new Date(parseInt(reset, 10) * 1000),
      used: used ? parseInt(used, 10) : 0,
    };

    if (this.rateLimitInfo.remaining < RATE_LIMIT_WARNING_THRESHOLD) {
      logger.warn(`${LOG_PREFIX} Approaching rate limit`, {
        remaining: this.rateLimitInfo.remaining,
        reset: this.rateLimitInfo.reset.toISOString(),
      });
    }
  }

  private createAPIError(status: number, body: string, endpoint: string): Error {
    let message: string;
    let errorType: "config" | "file" | "network" = "network";

    switch (status) {
      case 401: {
        errorType = "config";
        message = "GitHub API authentication failed. Check your GITHUB_TOKEN is valid.";
        break;
      }
      case 403: {
        if (this.rateLimitInfo?.remaining === 0) {
          message =
            `GitHub API rate limit exceeded. Resets at ${this.rateLimitInfo.reset.toISOString()}`;
          break;
        }

        errorType = "config";
        message = "GitHub API access forbidden. Check token permissions for this repository.";
        break;
      }
      case 404: {
        errorType = "file";
        message = `Not found: ${endpoint}`;
        break;
      }
      case 422: {
        errorType = "config";
        message = `Invalid request to GitHub API: ${body}`;
        break;
      }
      default: {
        message = `GitHub API error (${status}): ${body}`;
      }
    }

    const error = toError(
      createError({
        type: errorType,
        message,
      }),
    ) as APIError;

    error.statusCode = status;
    error.endpoint = endpoint;
    error.repo = this.repoId;

    return error;
  }

  private isClientError(error: Error): boolean {
    const statusCode = (error as APIError).statusCode;
    return statusCode !== undefined && statusCode >= 400 && statusCode < 500;
  }

  private isRateLimitError(error: Error): boolean {
    return (error as APIError).statusCode === 403 && this.rateLimitInfo?.remaining === 0;
  }

  private calculateRetryDelay(attempt: number, error: Error): number {
    if (this.isRateLimitError(error) && this.rateLimitInfo) {
      const waitMs = this.rateLimitInfo.reset.getTime() - Date.now();
      return Math.max(waitMs, this.config.retry.initialDelay);
    }

    const delay = Math.min(
      this.config.retry.initialDelay * Math.pow(2, attempt - 1),
      this.config.retry.maxDelay,
    );

    return delay + Math.random() * RETRY_JITTER_MAX_MS;
  }
}
