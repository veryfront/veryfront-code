import { logger } from "@veryfront/utils";
import { FileCache } from "../file-cache/file-cache.ts";
import type { FSAdapter, FSAdapterConfig } from "../veryfront-fs-adapter/types.ts";
import { GitHubAPIClient } from "./github-api-client.ts";
import { GitHubDirectoryOperations } from "./directory-operations.ts";
import { GitHubReadOperations } from "./read-operations.ts";
import { GitHubStatOperations } from "./stat-operations.ts";
import {
  createGitHubConfig,
  type DirectoryEntry,
  type FileInfo,
  type GitHubConfig,
  type ResolvedGitHubConfig,
} from "./types.ts";

const LOG_PREFIX = "[GitHubFSAdapter]";

/**
 * GitHub filesystem adapter for veryfront-renderer
 *
 * Provides read-only access to files in a GitHub repository via the GitHub API.
 * Uses tree-based indexing for efficient file resolution and caching.
 */
export class GitHubFSAdapter implements FSAdapter {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubAPIClient;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;
  private readonly readOps: GitHubReadOperations;
  private readonly dirOps: GitHubDirectoryOperations;
  private readonly projectDir: string;

  private initialized = false;

  constructor(adapterConfig: FSAdapterConfig) {
    if (!adapterConfig.github) {
      throw new Error("GitHub adapter requires github configuration");
    }

    // Store projectDir to strip from absolute paths
    this.projectDir = adapterConfig.projectDir || "";

    // Resolve config from raw config + environment
    const rawConfig: GitHubConfig = {
      token: adapterConfig.github.token || Deno.env.get("GITHUB_TOKEN") || "",
      owner: adapterConfig.github.owner || Deno.env.get("GITHUB_OWNER") || "",
      repo: adapterConfig.github.repo || Deno.env.get("GITHUB_REPO") || "",
      ref: adapterConfig.github.ref || Deno.env.get("GITHUB_REF") || "main",
      cache: adapterConfig.github.cache,
      retry: adapterConfig.github.retry,
    };

    this.config = createGitHubConfig(rawConfig);

    // Initialize components
    this.client = new GitHubAPIClient(this.config);

    this.cache = new FileCache({
      enabled: this.config.cache.enabled,
      ttl: this.config.cache.ttl,
      maxSize: this.config.cache.maxSize,
      maxMemory: this.config.cache.maxMemory,
    });

    this.statOps = new GitHubStatOperations(this.config, this.client, this.cache, this.projectDir);
    this.readOps = new GitHubReadOperations(
      this.config,
      this.client,
      this.cache,
      this.statOps,
      this.projectDir,
    );
    this.dirOps = new GitHubDirectoryOperations(
      this.config,
      this.cache,
      this.statOps,
      this.projectDir,
    );

    logger.info(`${LOG_PREFIX} Created adapter`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });
  }

  /**
   * Initialize the adapter by fetching the repository tree
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info(`${LOG_PREFIX} Initializing`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });

    // Build the file index from repository tree
    await this.statOps.buildIndex();

    this.initialized = true;

    logger.info(`${LOG_PREFIX} Initialized successfully`);
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<Uint8Array | string> {
    await this.ensureInitialized();
    return this.readOps.readFile(path);
  }

  /**
   * Read file content as text
   */
  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  /**
   * Check if file or directory exists
   */
  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.statOps.exists(path);
  }

  /**
   * Get file or directory stat information
   */
  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.statOps.stat(path);
  }

  /**
   * Read directory contents (async iterable)
   */
  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    await this.ensureInitialized();
    yield* this.dirOps.readDir(path);
  }

  /**
   * Read directory contents (array)
   */
  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.dirOps.readdir(path);
  }

  /**
   * Resolve a file path, trying various extensions
   */
  async resolveFile(basePath: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cache: {
      size: number;
      memoryUsed: number;
      hits: number;
      misses: number;
      hitRate: number;
    };
  } {
    const stats = this.cache.stats();
    return {
      cache: {
        size: stats.size,
        memoryUsed: stats.memoryUsed,
        hits: stats.hits,
        misses: stats.misses,
        hitRate: stats.hitRate,
      },
    };
  }

  /**
   * Get rate limit information from GitHub API
   */
  getRateLimitInfo(): {
    limit: number;
    remaining: number;
    reset: Date;
  } | null {
    return this.client.getRateLimitInfo();
  }

  /**
   * Clear all caches and reset state
   */
  dispose(): void {
    this.cache.clear();
    this.statOps.clearIndex();
    this.initialized = false;

    logger.info(`${LOG_PREFIX} Disposed`);
  }

  /**
   * Ensure adapter is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
