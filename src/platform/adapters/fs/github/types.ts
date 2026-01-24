/**
 * GitHub FS Adapter Types
 *
 * Re-exports API response types from schemas.ts and defines config types.
 */

import { createError, toError } from "#veryfront/errors";

export type { DirectoryEntry } from "../shared-types.ts";

export type {
  GitHubBlobResponse,
  GitHubContentItem,
  GitHubContentsResponse,
  GitHubTreeEntry,
  GitHubTreeResponse,
} from "./schemas.ts";

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

  const cache = config.cache;
  const retry = config.retry;

  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    ref: config.ref ?? "main",
    cache: {
      enabled: cache?.enabled ?? true,
      ttl: cache?.ttl ?? 60_000,
      maxSize: cache?.maxSize ?? 1000,
      maxMemory: cache?.maxMemory ?? 100 * 1024 * 1024,
    },
    retry: {
      maxRetries: retry?.maxRetries ?? 3,
      initialDelay: retry?.initialDelay ?? 1000,
      maxDelay: retry?.maxDelay ?? 10_000,
    },
  };
}
