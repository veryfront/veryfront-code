/**
 * GitHub FS Adapter Types
 *
 * Re-exports API response types from schemas.ts and defines config types.
 */
export type { DirectoryEntry } from "../shared-types.js";
export type { GitHubBlobResponse, GitHubContentItem, GitHubContentsResponse, GitHubTreeEntry, GitHubTreeResponse, } from "./schemas.js";
export interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
    ref?: string;
    cache?: {
        enabled?: boolean;
        ttl?: number;
        maxSize?: number;
        maxMemory?: number;
    };
    retry?: {
        maxRetries?: number;
        initialDelay?: number;
        maxDelay?: number;
    };
}
export interface ResolvedGitHubConfig {
    token: string;
    owner: string;
    repo: string;
    ref: string;
    cache: {
        enabled: boolean;
        ttl: number;
        maxSize: number;
        maxMemory: number;
    };
    retry: {
        maxRetries: number;
        initialDelay: number;
        maxDelay: number;
    };
}
export interface FileInfo {
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
}
export interface FileIndexEntry {
    path: string;
    sha: string;
    size: number;
    type: "blob" | "tree";
}
export declare function createGitHubConfig(config: GitHubConfig): ResolvedGitHubConfig;
//# sourceMappingURL=types.d.ts.map