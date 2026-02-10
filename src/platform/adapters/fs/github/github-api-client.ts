import { createError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import type { ResolvedGitHubConfig } from "./types.ts";
import {
  type GitHubBlobResponse,
  GitHubBlobResponseSchema,
  type GitHubContentItem,
  GitHubContentsResponseSchema,
  type GitHubTreeResponse,
  GitHubTreeResponseSchema,
} from "./schemas/index.ts";

const LOG_PREFIX = "[GitHubApiClient]";

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

type APIError = Error & { statusCode?: number; endpoint?: string; repo?: string };

export class GitHubApiClient {
  private readonly baseUrl = "https://api.github.com";
  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(private readonly config: ResolvedGitHubConfig) {}

  get repoId(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  async getTree(ref?: string): Promise<GitHubTreeResponse> {
    const treeRef = ref ?? this.config.ref;
    const endpoint =
      `/repos/${this.config.owner}/${this.config.repo}/git/trees/${treeRef}?recursive=1`;

    logger.debug(`${LOG_PREFIX} Fetching tree`, { ref: treeRef });

    const raw = await this.request(endpoint);
    const response = GitHubTreeResponseSchema.parse(raw);

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
    const normalizedPath = path.replace(/^\/+/, "");
    const endpoint =
      `/repos/${this.config.owner}/${this.config.repo}/contents/${normalizedPath}?ref=${contentRef}`;

    logger.debug(`${LOG_PREFIX} Fetching contents`, { path: normalizedPath });

    const raw = await this.request(endpoint);
    return GitHubContentsResponseSchema.parse(raw);
  }

  async getBlob(sha: string): Promise<GitHubBlobResponse> {
    const endpoint = `/repos/${this.config.owner}/${this.config.repo}/git/blobs/${sha}`;

    logger.debug(`${LOG_PREFIX} Fetching blob`, { sha });

    const raw = await this.request(endpoint);
    return GitHubBlobResponseSchema.parse(raw);
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  private async request(endpoint: string): Promise<unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retry.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "veryfront-server",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        this.updateRateLimitInfo(response);

        if (!response.ok) {
          const errorBody = await response.text();
          throw this.createAPIError(response.status, errorBody, endpoint);
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isClientError(lastError) && !this.isRateLimitError(lastError)) {
          throw lastError;
        }

        if (attempt >= this.config.retry.maxRetries) break;

        const delay = this.calculateRetryDelay(attempt, lastError);
        logger.warn(`${LOG_PREFIX} Request failed, retrying`, {
          attempt,
          delay,
          error: lastError.message,
        });
        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error("Request failed after retries");
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

    if (this.rateLimitInfo.remaining < 100) {
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

    return delay + Math.random() * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
