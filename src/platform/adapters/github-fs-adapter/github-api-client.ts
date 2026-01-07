import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { logger } from "@veryfront/utils";
import type {
  GitHubBlobResponse,
  GitHubContentItem,
  GitHubTreeResponse,
  ResolvedGitHubConfig,
} from "./types.ts";

const LOG_PREFIX = "[GitHubAPIClient]";

/**
 * Rate limit info from GitHub API response headers
 */
interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

/**
 * GitHub API client for repository operations
 */
export class GitHubAPIClient {
  private readonly baseUrl = "https://api.github.com";
  private readonly config: ResolvedGitHubConfig;
  private rateLimitInfo: RateLimitInfo | null = null;

  constructor(config: ResolvedGitHubConfig) {
    this.config = config;
  }

  /**
   * Get the repository identifier string
   */
  get repoId(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  /**
   * Fetch the full repository tree recursively
   */
  async getTree(ref?: string): Promise<GitHubTreeResponse> {
    const treeRef = ref || this.config.ref;
    const endpoint =
      `/repos/${this.config.owner}/${this.config.repo}/git/trees/${treeRef}?recursive=1`;

    logger.debug(`${LOG_PREFIX} Fetching tree`, { ref: treeRef });

    const response = await this.request<GitHubTreeResponse>(endpoint);

    if (response.truncated) {
      logger.warn(
        `${LOG_PREFIX} Repository tree is truncated. Large repos may have incomplete file listing.`,
      );
    }

    return response;
  }

  /**
   * Get file or directory contents
   */
  getContents(
    path: string,
    ref?: string,
  ): Promise<GitHubContentItem | GitHubContentItem[]> {
    const contentRef = ref || this.config.ref;
    const normalizedPath = path.replace(/^\/+/, "");
    const endpoint =
      `/repos/${this.config.owner}/${this.config.repo}/contents/${normalizedPath}?ref=${contentRef}`;

    logger.debug(`${LOG_PREFIX} Fetching contents`, { path: normalizedPath });

    return this.request<GitHubContentItem | GitHubContentItem[]>(endpoint);
  }

  /**
   * Get blob content by SHA (for files >1MB)
   */
  getBlob(sha: string): Promise<GitHubBlobResponse> {
    const endpoint = `/repos/${this.config.owner}/${this.config.repo}/git/blobs/${sha}`;

    logger.debug(`${LOG_PREFIX} Fetching blob`, { sha });

    return this.request<GitHubBlobResponse>(endpoint);
  }

  /**
   * Get current rate limit status
   */
  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  /**
   * Make an authenticated request to the GitHub API
   */
  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.config.retry.maxRetries) {
      attempt++;

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "veryfront-renderer",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        // Update rate limit info from headers
        this.updateRateLimitInfo(response);

        if (!response.ok) {
          const errorBody = await response.text();
          throw this.createAPIError(response.status, errorBody, endpoint);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry client errors (4xx) except rate limits
        if (this.isClientError(lastError) && !this.isRateLimitError(lastError)) {
          throw lastError;
        }

        // Check if we should retry
        if (attempt < this.config.retry.maxRetries) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          logger.warn(`${LOG_PREFIX} Request failed, retrying`, {
            attempt,
            delay,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Update rate limit info from response headers
   */
  private updateRateLimitInfo(response: Response): void {
    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const used = response.headers.get("X-RateLimit-Used");

    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: new Date(parseInt(reset, 10) * 1000),
        used: used ? parseInt(used, 10) : 0,
      };

      // Warn when approaching rate limit
      if (this.rateLimitInfo.remaining < 100) {
        logger.warn(`${LOG_PREFIX} Approaching rate limit`, {
          remaining: this.rateLimitInfo.remaining,
          reset: this.rateLimitInfo.reset.toISOString(),
        });
      }
    }
  }

  /**
   * Create an appropriate error for API responses
   */
  private createAPIError(
    status: number,
    body: string,
    endpoint: string,
  ): Error {
    let message: string;
    let errorType: "config" | "file" | "network" = "network";

    switch (status) {
      case 401:
        errorType = "config";
        message = "GitHub API authentication failed. Check your GITHUB_TOKEN is valid.";
        break;
      case 403:
        if (this.rateLimitInfo && this.rateLimitInfo.remaining === 0) {
          message =
            `GitHub API rate limit exceeded. Resets at ${this.rateLimitInfo.reset.toISOString()}`;
        } else {
          errorType = "config";
          message = "GitHub API access forbidden. Check token permissions for this repository.";
        }
        break;
      case 404:
        errorType = "file";
        message = `Not found: ${endpoint}`;
        break;
      case 422:
        errorType = "config";
        message = `Invalid request to GitHub API: ${body}`;
        break;
      default:
        message = `GitHub API error (${status}): ${body}`;
    }

    const error = toError(
      createError({
        type: errorType,
        message,
      }),
    );

    // Add status code and context for error handling
    (error as Error & { statusCode?: number; endpoint?: string; repo?: string }).statusCode =
      status;
    (error as Error & { endpoint?: string }).endpoint = endpoint;
    (error as Error & { repo?: string }).repo = this.repoId;

    return error;
  }

  /**
   * Check if error is a client error (4xx)
   */
  private isClientError(error: Error): boolean {
    return (
      (error as Error & { statusCode?: number }).statusCode !== undefined &&
      (error as Error & { statusCode?: number }).statusCode! >= 400 &&
      (error as Error & { statusCode?: number }).statusCode! < 500
    );
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: Error): boolean {
    return (
      (error as Error & { statusCode?: number }).statusCode === 403 &&
      this.rateLimitInfo !== null &&
      this.rateLimitInfo.remaining === 0
    );
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, error: Error): number {
    // If rate limited, wait until reset
    if (this.isRateLimitError(error) && this.rateLimitInfo) {
      const waitMs = this.rateLimitInfo.reset.getTime() - Date.now();
      return Math.max(waitMs, this.config.retry.initialDelay);
    }

    // Exponential backoff
    const delay = Math.min(
      this.config.retry.initialDelay * Math.pow(2, attempt - 1),
      this.config.retry.maxDelay,
    );

    // Add jitter
    return delay + Math.random() * 1000;
  }

  /**
   * Sleep for the specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
