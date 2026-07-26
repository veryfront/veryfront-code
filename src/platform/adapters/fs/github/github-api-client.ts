import { createError, retryWithBackoff, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import {
  filesystemTotalAttempts,
  normalizeFilesystemRetryConfig,
} from "#veryfront/utils/config-resource-limits.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
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
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const MAX_GITHUB_ERROR_BODY_BYTES = 8 * 1024;

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

type APIError = Error & {
  statusCode?: number;
  endpoint?: string;
  repo?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
  rateLimitResetAt?: number;
};

export class GitHubApiClient {
  private readonly baseUrl = "https://api.github.com";
  private rateLimitInfo: RateLimitInfo | null = null;
  private readonly config: ResolvedGitHubConfig;

  constructor(config: ResolvedGitHubConfig) {
    this.config = {
      ...config,
      retry: normalizeFilesystemRetryConfig(
        config.retry,
        config.retry,
        "legacy-total-attempts",
      ),
    };
  }

  get repoId(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  async getTree(ref?: string): Promise<GitHubTreeResponse> {
    const treeRef = ref ?? this.config.ref;
    const endpoint = `/repos/${encodeURIComponent(this.config.owner)}/${
      encodeURIComponent(this.config.repo)
    }/git/trees/${encodeURIComponent(treeRef)}?recursive=1`;

    logger.debug(`${LOG_PREFIX} Fetching tree`, { ref: treeRef });

    const raw = await this.request(endpoint);
    const response = getGitHubTreeResponseSchema().parse(raw);

    if (response.truncated) {
      throw toError(
        createError({
          type: "network",
          message:
            "GitHub returned a truncated recursive repository tree; refusing to build an incomplete filesystem index.",
        }),
      );
    }

    return response;
  }

  async getContents(
    path: string,
    ref?: string,
  ): Promise<GitHubContentItem | GitHubContentItem[]> {
    const contentRef = ref ?? this.config.ref;
    const normalizedPath = path.replace(/^\/+/, "");
    const encodedPath = encodeGitHubPath(normalizedPath);
    const contentPath = encodedPath ? `/contents/${encodedPath}` : "/contents";
    const endpoint = `/repos/${encodeURIComponent(this.config.owner)}/${
      encodeURIComponent(this.config.repo)
    }${contentPath}?ref=${encodeURIComponent(contentRef)}`;

    logger.debug(`${LOG_PREFIX} Fetching contents`, { path: normalizedPath });

    const raw = await this.request(endpoint);
    return getGitHubContentsResponseSchema().parse(raw);
  }

  async getBlob(sha: string): Promise<GitHubBlobResponse> {
    const endpoint = `/repos/${encodeURIComponent(this.config.owner)}/${
      encodeURIComponent(this.config.repo)
    }/git/blobs/${encodeURIComponent(sha)}`;

    logger.debug(`${LOG_PREFIX} Fetching blob`, { sha });

    const raw = await this.request(endpoint);
    return getGitHubBlobResponseSchema().parse(raw);
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  private request(endpoint: string): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;

    return retryWithBackoff(
      async (signal) => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "veryfront-server",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal,
        });

        const rateLimitInfo = this.updateRateLimitInfo(response);

        if (!response.ok) {
          const { text, truncated } = await readResponseTextPrefix(
            response,
            MAX_GITHUB_ERROR_BODY_BYTES,
            signal,
          );
          const errorBody = truncated ? `${text}\n[response body truncated]` : text;
          throw this.createAPIError(
            response.status,
            errorBody,
            endpoint,
            rateLimitInfo,
            response.headers,
          );
        }

        return response.json();
      },
      {
        maxAttempts: filesystemTotalAttempts(
          this.config.retry.maxRetries,
          "legacy-total-attempts",
        ),
        initialDelay: this.config.retry.initialDelay,
        maxDelay: this.config.retry.maxDelay,
        timeoutMs: GITHUB_REQUEST_TIMEOUT_MS,
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

  private updateRateLimitInfo(response: Response): RateLimitInfo | null {
    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const used = response.headers.get("X-RateLimit-Used");

    if (!limit || !remaining || !reset) return null;

    const parsedLimit = parseNonNegativeSafeInteger(limit);
    const parsedRemaining = parseNonNegativeSafeInteger(remaining);
    const parsedReset = parseNonNegativeSafeInteger(reset);
    const parsedUsed = used === null ? 0 : parseNonNegativeSafeInteger(used);
    const resetDate = parsedReset === null ? null : new Date(parsedReset * 1000);
    if (
      parsedLimit === null ||
      parsedRemaining === null ||
      parsedUsed === null ||
      resetDate === null ||
      !Number.isFinite(resetDate.getTime())
    ) {
      logger.warn(`${LOG_PREFIX} Ignoring malformed rate-limit headers`);
      return null;
    }

    const info: RateLimitInfo = {
      limit: parsedLimit,
      remaining: parsedRemaining,
      reset: resetDate,
      used: parsedUsed,
    };
    this.rateLimitInfo = info;

    if (info.remaining < RATE_LIMIT_WARNING_THRESHOLD) {
      logger.warn(`${LOG_PREFIX} Approaching rate limit`, {
        remaining: info.remaining,
        reset: info.reset.toISOString(),
      });
    }
    return info;
  }

  private createAPIError(
    status: number,
    body: string,
    endpoint: string,
    rateLimitInfo: RateLimitInfo | null,
    headers: Headers,
  ): Error {
    let message: string;
    let errorType: "config" | "file" | "network" = "network";
    const retryAfterMs = parseRetryAfterMs(headers.get("Retry-After"));
    const rateLimited = status === 429 ||
      (status === 403 && (rateLimitInfo?.remaining === 0 || retryAfterMs !== null));

    switch (true) {
      case rateLimited: {
        message = rateLimitInfo
          ? `GitHub API rate limit exceeded. Resets at ${rateLimitInfo.reset.toISOString()}`
          : "GitHub API rate limit exceeded.";
        break;
      }
      case status === 401: {
        errorType = "config";
        message = "GitHub API authentication failed. Check your GITHUB_TOKEN is valid.";
        break;
      }
      case status === 403: {
        errorType = "config";
        message = "GitHub API access forbidden. Check token permissions for this repository.";
        break;
      }
      case status === 404: {
        errorType = "file";
        message = `Not found: ${endpoint}`;
        break;
      }
      case status === 422: {
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
    error.rateLimited = rateLimited;
    if (retryAfterMs !== null) error.retryAfterMs = retryAfterMs;
    if (rateLimitInfo) error.rateLimitResetAt = rateLimitInfo.reset.getTime();

    return error;
  }

  private isClientError(error: Error): boolean {
    const statusCode = (error as APIError).statusCode;
    return statusCode !== undefined && statusCode >= 400 && statusCode < 500;
  }

  private isRateLimitError(error: Error): boolean {
    return (error as APIError).rateLimited === true;
  }

  private calculateRetryDelay(attempt: number, error: Error): number {
    const maxDelay = this.config.retry.maxDelay;
    if (this.isRateLimitError(error)) {
      const apiError = error as APIError;
      const waitMs = apiError.retryAfterMs ??
        (apiError.rateLimitResetAt === undefined
          ? Number.NaN
          : apiError.rateLimitResetAt - Date.now());
      const requestedDelay = Number.isFinite(waitMs)
        ? Math.max(waitMs, this.config.retry.initialDelay)
        : maxDelay;
      return Math.min(Math.max(0, requestedDelay), maxDelay);
    }

    const delay = Math.min(
      this.config.retry.initialDelay * Math.pow(2, attempt - 1),
      maxDelay,
    );
    const jitterBudget = Math.min(
      RETRY_JITTER_MAX_MS,
      Math.max(0, maxDelay - delay),
    );

    return Math.min(delay + Math.random() * jitterBudget, maxDelay);
  }
}

function encodeGitHubPath(path: string): string {
  return path.split("/").map((segment) => {
    if (segment === "." || segment === "..") {
      throw new TypeError("GitHub content path must not contain dot or traversal segments");
    }
    return encodeURIComponent(segment);
  }).join("/");
}

function parseNonNegativeSafeInteger(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null;

  const seconds = parseNonNegativeSafeInteger(value);
  if (seconds !== null) {
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}
