import type { FileCache } from "../cache/file-cache.js";
import type { GitHubAPIClient } from "./github-api-client.js";
import type { GitHubStatOperations } from "./stat-operations.js";
import type { ResolvedGitHubConfig } from "./types.js";
export declare class GitHubReadOperations {
    private readonly config;
    private readonly client;
    private readonly cache;
    private readonly statOps;
    private readonly projectDir;
    constructor(config: ResolvedGitHubConfig, client: GitHubAPIClient, cache: FileCache, statOps: GitHubStatOperations, projectDir?: string);
    readTextFile(path: string): Promise<string>;
    readFile(path: string): Promise<Uint8Array>;
    private readContentsFile;
    private readContentsFileBytes;
    private getFileItemFromContents;
    private readLargeFile;
    private readLargeFileBytes;
    private decodeBase64ToBytes;
    private decodeBase64;
    private normalizePath;
}
//# sourceMappingURL=read-operations.d.ts.map