import { createError, toError } from "#veryfront/errors";

export type { DirectoryEntry } from "../shared-types.ts";

export type {
  GitHubBlobResponse,
  GitHubContentItem,
  GitHubContentsResponse,
  GitHubTreeEntry,
  GitHubTreeResponse,
} from "./schemas/index.ts";

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

  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    ref: config.ref ?? "main",
    cache: {
      enabled: config.cache?.enabled ?? true,
      ttl: config.cache?.ttl ?? 60_000,
      maxSize: config.cache?.maxSize ?? 1000,
      maxMemory: config.cache?.maxMemory ?? 100 * 1024 * 1024,
    },
    retry: {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelay: config.retry?.initialDelay ?? 1000,
      maxDelay: config.retry?.maxDelay ?? 10_000,
    },
  };
}
