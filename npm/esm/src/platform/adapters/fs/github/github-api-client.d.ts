import type { ResolvedGitHubConfig } from "./types.js";
import { type GitHubBlobResponse, type GitHubContentItem, type GitHubTreeResponse } from "./schemas.js";
interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: Date;
    used: number;
}
export declare class GitHubAPIClient {
    private readonly baseUrl;
    private readonly config;
    private rateLimitInfo;
    constructor(config: ResolvedGitHubConfig);
    get repoId(): string;
    getTree(ref?: string): Promise<GitHubTreeResponse>;
    getContents(path: string, ref?: string): Promise<GitHubContentItem | GitHubContentItem[]>;
    getBlob(sha: string): Promise<GitHubBlobResponse>;
    getRateLimitInfo(): RateLimitInfo | null;
    private request;
    private updateRateLimitInfo;
    private createAPIError;
    private isClientError;
    private isRateLimitError;
    private calculateRetryDelay;
    private sleep;
}
export {};
//# sourceMappingURL=github-api-client.d.ts.map