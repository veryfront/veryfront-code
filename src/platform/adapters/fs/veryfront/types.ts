import type { Project } from "../../veryfront-api-client/index.ts";
import { createError, toError } from "#veryfront/errors";
import type { GitHubConfig } from "../github/types.ts";
// Import and re-export from shared types to avoid circular dependencies
import type { DirectoryEntry } from "../shared-types.ts";
export type { DirectoryEntry };

/**
 * Base FSAdapter interface for filesystem operations.
 * All methods that are optional should be checked before calling.
 */
export interface FSAdapter {
  // Core read operations
  readFile(path: string): Promise<Uint8Array | string>;
  readTextFile?(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
  }>;

  // Directory operations (optional - not all adapters support)
  readDir?(path: string): AsyncIterable<DirectoryEntry>;
  readdir?(path: string): AsyncIterable<DirectoryEntry> | Promise<DirectoryEntry[]>;

  // Write operations (optional - read-only adapters don't support)
  writeFile?(path: string, content: string): Promise<void>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove?(path: string, options?: { recursive?: boolean }): Promise<void>;

  // Lifecycle
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;

  // File resolution (optional - for path extension fallbacks)
  resolveFile?(basePath: string): Promise<string | null>;
}

/**
 * Extended FSAdapter interface for adapters that support per-request context.
 * Used by VeryfrontFSAdapter and MultiProjectFSAdapter.
 */
export interface ContextualFSAdapter extends FSAdapter {
  // Per-request token management
  setRequestToken?(token: string): void;
  clearRequestToken?(): void;

  // Per-request branch management
  setRequestBranch?(branch: string | null): void;
  getRequestBranch?(): string | null;
  clearRequestBranch?(): void;

  // Production mode
  setProductionMode?(enabled: boolean, releaseId?: string | null): void;

  // Multi-project context (for proxy mode)
  // Note: releaseId and branch are mutually exclusive
  // - productionMode=true → use releaseId
  // - productionMode=false → use branch
  runWithContext?<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T>;
}

/**
 * Content source configuration for determining where to fetch files from.
 *
 * - branch: Draft content from a git branch (default: "main")
 * - environment: Published content from a named environment ("production", "preview", "staging")
 * - domain: Resolve environment via domain lookup API
 * - release: Specific release by ID or "latest"
 */
export type ContentSource =
  | { type: "branch"; branch?: string }
  | { type: "environment"; name: string }
  | { type: "domain"; domain: string }
  | { type: "release"; releaseId?: string };

/**
 * Resolved content context after initialization.
 * Used for cache keys and API calls.
 */
export interface ResolvedContentContext {
  sourceType: "branch" | "environment" | "release";
  projectSlug: string;
  branch?: string;
  environmentName?: string;
  releaseId?: string;
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
    /**
     * Content source configuration.
     * - { type: "branch", branch: "main" } - Draft content (default)
     * - { type: "environment", name: "production" } - Published to environment
     * - { type: "domain", domain: "example.veryfront.com" } - Resolve via domain lookup
     * - { type: "release", releaseId: "uuid" } - Specific release
     */
    contentSource?: ContentSource;
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
  /** Content source configuration */
  contentSource: ContentSource;
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
  poke?: {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  };
}

/**
 * Project context for cache invalidation.
 * Used to clear only caches for a specific project in multi-tenant deployments.
 */
export interface InvalidationProjectContext {
  projectId?: string;
  projectSlug?: string;
  projectDir?: string;
}

/**
 * Callbacks for cache invalidation operations.
 * These are injected to decouple the adapter from rendering/server internals.
 * All callbacks are optional - no-ops are used when not provided.
 */
export interface InvalidationCallbacks {
  /** Clear SSR module cache (full invalidation - DEPRECATED: use clearSSRModuleCacheForProject) */
  clearSSRModuleCache?: () => void;
  /** Clear SSR module cache for a specific project */
  clearSSRModuleCacheForProject?: (projectId: string) => void;
  /** Clear router detection cache (full - DEPRECATED: use clearRouterDetectionCacheForProject) */
  clearRouterDetectionCache?: () => void;
  /** Clear router detection cache for a specific project */
  clearRouterDetectionCacheForProject?: (projectDir: string) => void;
  /** Clear module path resolution cache */
  clearModulePathCache?: () => void;
  /** Invalidate specific module paths (selective invalidation) */
  invalidateModulePaths?: (changedPaths: string[]) => void;
  /** Clear snippet rendering cache (full - DEPRECATED: use clearSnippetCacheForProject) */
  clearSnippetCache?: () => void;
  /** Clear snippet rendering cache for a specific project */
  clearSnippetCacheForProject?: (projectSlug: string) => void;
  /** Trigger browser reload notification with project context */
  triggerReload?: (changedPaths?: string[], project?: InvalidationProjectContext) => void;
  /** Clear renderer result cache (context-aware HTML cache) */
  clearRendererCache?: () => void;
  /** Clear renderer cache for a specific project */
  clearRendererCacheForProject?: (projectId: string) => void;
}

/**
 * Resolve content source from config.
 */
function resolveContentSource(veryfront: NonNullable<FSAdapterConfig["veryfront"]>): ContentSource {
  // Return configured content source or default to branch mode
  return veryfront.contentSource ?? { type: "branch", branch: "main" };
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
    contentSource: resolveContentSource(config.veryfront),
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
