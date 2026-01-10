/**
 * GitHub FS Adapter Types
 *
 * Re-exports API response types from schemas.ts and defines config types.
 */

import { createError, toError } from "../../../../core/errors/veryfront-error.ts";

// Import and re-export from shared types to avoid circular dependencies
export type { DirectoryEntry } from "../shared-types.ts";

// Re-export API response types from schemas
export type {
  GitHubBlobResponse,
  GitHubContentItem,
  GitHubContentsResponse,
  GitHubTreeEntry,
  GitHubTreeResponse,
} from "./schemas.ts";

/**
 * GitHub repository configuration
 */
export interface GitHubConfig {
  /** Personal Access Token for GitHub API authentication */
  token: string;
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Branch, tag, or commit SHA (default: "main") */
  ref?: string;
  /** Cache configuration */
  cache?: {
    enabled?: boolean;
    /** TTL in milliseconds (default: 60000) */
    ttl?: number;
    /** Max entries (default: 1000) */
    maxSize?: number;
    /** Max memory in bytes (default: 100MB) */
    maxMemory?: number;
  };
  /** Retry configuration */
  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

/**
 * Resolved GitHub configuration with defaults applied
 */
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

/**
 * File info structure matching FSAdapter.stat return type
 */
export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
}

/**
 * Internal file index entry
 */
export interface FileIndexEntry {
  path: string;
  sha: string;
  size: number;
  type: "blob" | "tree";
}

/**
 * Create resolved config with defaults from raw GitHubConfig
 */
export function createGitHubConfig(config: GitHubConfig): ResolvedGitHubConfig {
  if (!config.token) {
    throw toError(
      createError({
        type: "config",
        message:
          "GitHub adapter requires a token. Set GITHUB_TOKEN environment variable or provide token in config.",
      }),
    );
  }

  if (!config.owner || !config.repo) {
    throw toError(
      createError({
        type: "config",
        message:
          "GitHub adapter requires owner and repo. Provide them in config or via GITHUB_OWNER and GITHUB_REPO environment variables.",
      }),
    );
  }

  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    ref: config.ref || "main",
    cache: {
      enabled: config.cache?.enabled ?? true,
      ttl: config.cache?.ttl ?? 60_000,
      maxSize: config.cache?.maxSize ?? 1000,
      maxMemory: config.cache?.maxMemory ?? 100 * 1024 * 1024,
    },
    retry: {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelay: config.retry?.initialDelay ?? 1000,
      maxDelay: config.retry?.maxDelay ?? 10000,
    },
  };
}
