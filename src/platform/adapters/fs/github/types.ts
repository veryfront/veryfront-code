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

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_CACHE_MAX_MEMORY_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;

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
      ttl: config.cache?.ttl ?? DEFAULT_CACHE_TTL_MS,
      maxSize: config.cache?.maxSize ?? DEFAULT_CACHE_MAX_ENTRIES,
      maxMemory: config.cache?.maxMemory ?? DEFAULT_CACHE_MAX_MEMORY_BYTES,
    },
    retry: {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      initialDelay: config.retry?.initialDelay ?? DEFAULT_INITIAL_RETRY_DELAY_MS,
      maxDelay: config.retry?.maxDelay ?? DEFAULT_MAX_RETRY_DELAY_MS,
    },
  };
}
