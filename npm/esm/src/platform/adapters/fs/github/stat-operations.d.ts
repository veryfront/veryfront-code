import type { FileCache } from "../cache/file-cache.js";
import type { GitHubAPIClient } from "./github-api-client.js";
import type { FileIndexEntry, FileInfo, ResolvedGitHubConfig } from "./types.js";
export declare class GitHubStatOperations {
    private readonly config;
    private readonly client;
    private readonly cache;
    private readonly projectDir;
    private fileIndex;
    private directoryIndex;
    private buildingIndex;
    private indexBuilt;
    constructor(config: ResolvedGitHubConfig, client: GitHubAPIClient, cache: FileCache, projectDir?: string);
    buildIndex(): Promise<void>;
    private doBuildIndex;
    private buildIndexFromEntries;
    private addDirectoryHierarchy;
    stat(path: string): Promise<FileInfo>;
    exists(path: string): Promise<boolean>;
    resolveFile(basePath: string): Promise<string | null>;
    private tryResolve;
    private tryResolveWithPagesPrefix;
    getFileEntry(path: string): FileIndexEntry | undefined;
    getFilesInDirectory(dirPath: string): FileIndexEntry[];
    getSubdirectories(dirPath: string): string[];
    isDirectory(path: string): boolean;
    clearIndex(): void;
    private ensureIndex;
    private normalizePath;
}
//# sourceMappingURL=stat-operations.d.ts.map