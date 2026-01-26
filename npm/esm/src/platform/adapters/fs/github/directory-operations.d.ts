import type { FileCache } from "../cache/file-cache.js";
import type { GitHubStatOperations } from "./stat-operations.js";
import type { DirectoryEntry, ResolvedGitHubConfig } from "./types.js";
export declare class GitHubDirectoryOperations {
    private readonly config;
    private readonly cache;
    private readonly statOps;
    private readonly projectDir;
    constructor(config: ResolvedGitHubConfig, cache: FileCache, statOps: GitHubStatOperations, projectDir?: string);
    readdir(path: string): DirectoryEntry[];
    readDir(path: string): AsyncIterable<DirectoryEntry>;
    private normalizePath;
}
//# sourceMappingURL=directory-operations.d.ts.map