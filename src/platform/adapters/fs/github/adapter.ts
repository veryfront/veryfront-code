import { logger } from "#veryfront/utils";
import { CONFIG_INVALID } from "#veryfront/errors";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { FSAdapter, FSAdapterConfig } from "../veryfront/types.ts";
import { GitHubApiClient } from "./github-api-client.ts";
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

export class GitHubFSAdapter implements FSAdapter {
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubApiClient;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;
  private readonly readOps: GitHubReadOperations;
  private readonly dirOps: GitHubDirectoryOperations;
  private readonly projectDir: string;

  private initialized = false;

  constructor(adapterConfig: FSAdapterConfig) {
    const githubConfig = adapterConfig.github;
    if (!githubConfig) {
      throw CONFIG_INVALID.create({ detail: "GitHub adapter requires github configuration" });
    }

    this.projectDir = adapterConfig.projectDir ?? "";

    const rawConfig: GitHubConfig = {
      token: githubConfig.token ?? getEnv("GITHUB_TOKEN") ?? "",
      owner: githubConfig.owner ?? getEnv("GITHUB_OWNER") ?? "",
      repo: githubConfig.repo ?? getEnv("GITHUB_REPO") ?? "",
      ref: githubConfig.ref ?? getEnv("GITHUB_REF") ?? "main",
      cache: githubConfig.cache,
      retry: githubConfig.retry,
    };

    this.config = createGitHubConfig(rawConfig);
    this.client = new GitHubApiClient(this.config);

    this.cache = new FileCache(this.config.cache);

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

    logger.debug(`${LOG_PREFIX} Created adapter`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug(`${LOG_PREFIX} Initializing`, {
      repo: this.client.repoId,
      ref: this.config.ref,
    });

    await this.statOps.buildIndex();
    this.initialized = true;

    logger.debug(`${LOG_PREFIX} Initialized successfully`);
  }

  async readFile(path: string): Promise<Uint8Array | string> {
    await this.ensureInitialized();
    return this.readOps.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.statOps.exists(path);
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.statOps.stat(path);
  }

  async *readDir(path: string): AsyncIterable<DirectoryEntry> {
    await this.ensureInitialized();
    yield* this.dirOps.readDir(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.dirOps.readdir(path);
  }

  async resolveFile(basePath: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath);
  }

  getCacheStats(): {
    cache: {
      size: number;
      memoryUsed: number;
      hits: number;
      misses: number;
      hitRate: number;
    };
  } {
    return { cache: this.cache.stats() };
  }

  getRateLimitInfo(): { limit: number; remaining: number; reset: Date } | null {
    return this.client.getRateLimitInfo();
  }

  dispose(): void {
    this.cache.clear();
    this.statOps.clearIndex();
    this.initialized = false;

    logger.debug(`${LOG_PREFIX} Disposed`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.initialize();
  }
}
