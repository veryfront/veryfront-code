import * as dntShim from "../../../../../_dnt.shims.js";
import { createError, toError } from "../../../../errors/index.js";
import { logger } from "../../../../utils/index.js";
import { GitHubBlobResponseSchema, GitHubContentsResponseSchema, GitHubTreeResponseSchema, } from "./schemas.js";
const LOG_PREFIX = "[GitHubAPIClient]";
export class GitHubAPIClient {
    baseUrl = "https://api.github.com";
    config;
    rateLimitInfo = null;
    constructor(config) {
        this.config = config;
    }
    get repoId() {
        return `${this.config.owner}/${this.config.repo}`;
    }
    async getTree(ref) {
        const treeRef = ref ?? this.config.ref;
        const endpoint = `/repos/${this.config.owner}/${this.config.repo}/git/trees/${treeRef}?recursive=1`;
        logger.debug(`${LOG_PREFIX} Fetching tree`, { ref: treeRef });
        const raw = await this.request(endpoint);
        const response = GitHubTreeResponseSchema.parse(raw);
        if (response.truncated) {
            logger.warn(`${LOG_PREFIX} Repository tree is truncated. Large repos may have incomplete file listing.`);
        }
        return response;
    }
    async getContents(path, ref) {
        const contentRef = ref ?? this.config.ref;
        const normalizedPath = path.replace(/^\/+/, "");
        const endpoint = `/repos/${this.config.owner}/${this.config.repo}/contents/${normalizedPath}?ref=${contentRef}`;
        logger.debug(`${LOG_PREFIX} Fetching contents`, { path: normalizedPath });
        const raw = await this.request(endpoint);
        return GitHubContentsResponseSchema.parse(raw);
    }
    async getBlob(sha) {
        const endpoint = `/repos/${this.config.owner}/${this.config.repo}/git/blobs/${sha}`;
        logger.debug(`${LOG_PREFIX} Fetching blob`, { sha });
        const raw = await this.request(endpoint);
        return GitHubBlobResponseSchema.parse(raw);
    }
    getRateLimitInfo() {
        return this.rateLimitInfo;
    }
    async request(endpoint) {
        const url = `${this.baseUrl}${endpoint}`;
        let lastError = null;
        for (let attempt = 1; attempt <= this.config.retry.maxRetries; attempt++) {
            try {
                const response = await dntShim.fetch(url, {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                        Accept: "application/vnd.github.v3+json",
                        "User-Agent": "veryfront-renderer",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                });
                this.updateRateLimitInfo(response);
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw this.createAPIError(response.status, errorBody, endpoint);
                }
                return await response.json();
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (this.isClientError(lastError) && !this.isRateLimitError(lastError)) {
                    throw lastError;
                }
                if (attempt >= this.config.retry.maxRetries)
                    break;
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
    updateRateLimitInfo(response) {
        const limit = response.headers.get("X-RateLimit-Limit");
        const remaining = response.headers.get("X-RateLimit-Remaining");
        const reset = response.headers.get("X-RateLimit-Reset");
        const used = response.headers.get("X-RateLimit-Used");
        if (!limit || !remaining || !reset)
            return;
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
    createAPIError(status, body, endpoint) {
        let message;
        let errorType = "network";
        switch (status) {
            case 401:
                errorType = "config";
                message = "GitHub API authentication failed. Check your GITHUB_TOKEN is valid.";
                break;
            case 403:
                if (this.rateLimitInfo?.remaining === 0) {
                    message =
                        `GitHub API rate limit exceeded. Resets at ${this.rateLimitInfo.reset.toISOString()}`;
                }
                else {
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
        const error = toError(createError({
            type: errorType,
            message,
        }));
        error.statusCode = status;
        error.endpoint = endpoint;
        error.repo = this.repoId;
        return error;
    }
    isClientError(error) {
        const statusCode = error.statusCode;
        return statusCode !== undefined && statusCode >= 400 && statusCode < 500;
    }
    isRateLimitError(error) {
        return error.statusCode === 403 && this.rateLimitInfo?.remaining === 0;
    }
    calculateRetryDelay(attempt, error) {
        if (this.isRateLimitError(error) && this.rateLimitInfo) {
            const waitMs = this.rateLimitInfo.reset.getTime() - Date.now();
            return Math.max(waitMs, this.config.retry.initialDelay);
        }
        const delay = Math.min(this.config.retry.initialDelay * Math.pow(2, attempt - 1), this.config.retry.maxDelay);
        return delay + Math.random() * 1000;
    }
    sleep(ms) {
        return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
    }
}
