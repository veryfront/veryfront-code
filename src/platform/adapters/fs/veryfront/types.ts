import type { Project } from "../../veryfront-api-client/index.ts";
import { createError, toError } from "../../../../core/errors/veryfront-error.ts";
import type { GitHubConfig } from "../github/types.ts";
// Import and re-export from shared types to avoid circular dependencies
import type { DirectoryEntry } from "../shared-types.ts";
export type { DirectoryEntry };

export interface FSAdapter {
  readFile(path: string): Promise<Uint8Array | string>;
  readTextFile?(path: string): Promise<string>;
  writeFile?(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
  }>;
  readDir?(path: string): AsyncIterable<DirectoryEntry>;
  readdir?(path: string): AsyncIterable<DirectoryEntry> | Promise<DirectoryEntry[]>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove?(path: string, options?: { recursive?: boolean }): Promise<void>;
  initialize?(): Promise<void>;
  resolveFile?(basePath: string): Promise<string | null>;
}

export interface FSAdapterConfig {
  type?: "local" | "veryfront-api" | "memory" | "github";
  projectDir?: string;
  veryfront?: {
    apiKey?: string;
    apiToken?: string;
    projectSlug?: string;
    projectId?: string;
    baseUrl?: string;
    proxyMode?: boolean;
    productionMode?: boolean;
    releaseId?: string;
    cache?: {
      enabled?: boolean;
      ttl?: number;
    };
    retry?: {
      maxRetries?: number;
      retryDelay?: number;
    };
  };
  github?: GitHubConfig;
  /** Callbacks for cache invalidation (injected from server layer) */
  invalidationCallbacks?: InvalidationCallbacks;
}

export interface VeryfrontConfig {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  projectId?: string;
  proxyMode?: boolean;
  productionMode?: boolean;
  releaseId?: string;
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

export interface VeryfrontFSState {
  initialized: boolean;
  projectDir?: string;
  projectData?: Project;
}

export interface CacheStats {
  cache: {
    size: number;
    memoryUsed: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
}

/**
 * Callbacks for cache invalidation operations.
 * These are injected to decouple the adapter from rendering/server internals.
 * All callbacks are optional - no-ops are used when not provided.
 */
export interface InvalidationCallbacks {
  /** Clear SSR module cache (full invalidation) */
  clearSSRModuleCache?: () => void;
  /** Clear router detection cache */
  clearRouterDetectionCache?: () => void;
  /** Clear module path resolution cache */
  clearModulePathCache?: () => void;
  /** Invalidate specific module paths (selective invalidation) */
  invalidateModulePaths?: (changedPaths: string[]) => void;
  /** Clear snippet rendering cache */
  clearSnippetCache?: () => void;
  /** Trigger browser reload notification */
  triggerReload?: (changedPaths?: string[]) => void;
}

export function createVeryfrontConfig(config: FSAdapterConfig): VeryfrontConfig {
  if (!config.veryfront) {
    throw toError(createError({
      type: "config",
      message: "Veryfront adapter requires veryfront configuration",
    }));
  }

  return {
    apiBaseUrl: config.veryfront.baseUrl || "",
    apiToken: config.veryfront.apiToken || config.veryfront.apiKey || "",
    projectSlug: config.veryfront.projectSlug || "",
    projectId: config.veryfront.projectId,
    proxyMode: config.veryfront.proxyMode,
    productionMode: config.veryfront.productionMode,
    releaseId: config.veryfront.releaseId,
    cache: {
      enabled: true,
      ttl: 60_000,
      maxSize: 1000,
      maxMemory: 100 * 1024 * 1024,
      ...config.veryfront.cache,
    },
    retry: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      ...config.veryfront.retry,
    },
  };
}
