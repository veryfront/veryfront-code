import { logger } from "#veryfront/utils/logger/logger.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { ResolveFileOptions } from "../../base.ts";
import { FileCache } from "../cache/file-cache.ts";
import { FS_ADAPTER_KIND, type FSAdapter, type FSAdapterConfig } from "../veryfront/types.ts";
import { GitHubApiClient, type GitHubRateLimitInfo } from "./github-api-client.ts";
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
import { normalizeGitHubProjectDir } from "./path-utils.ts";

const LOG_PREFIX = "[GitHubFSAdapter]";

function invalidAdapterConfig(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

function assertReadableObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null) {
    invalidAdapterConfig(`${label} must be an object`);
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidAdapterConfig(`${label} is not readable`);
  }
  if (isArray) invalidAdapterConfig(`${label} must be an object`);
}

function readProperty(value: object, property: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    invalidAdapterConfig(`${label} is not readable`);
  }
}

function readEnvironmentValue(key: string): string | undefined {
  try {
    return getEnv(key);
  } catch {
    invalidAdapterConfig("GitHub environment configuration could not be read");
  }
}

function snapshotAdapterConfig(input: unknown): {
  readonly github: GitHubConfig;
  readonly projectDir: string;
} {
  assertReadableObject(input, "GitHub adapter configuration");
  const github = readProperty(input, "github", "GitHub adapter configuration");
  if (github === undefined || github === null) {
    invalidAdapterConfig("GitHub adapter requires github configuration");
  }
  assertReadableObject(github, "GitHub configuration");

  const projectDirInput = readProperty(input, "projectDir", "GitHub adapter configuration");
  if (
    projectDirInput !== undefined &&
    (typeof projectDirInput !== "string" || projectDirInput.length > 4_096)
  ) {
    invalidAdapterConfig("GitHub adapter projectDir must be a string of at most 4096 characters");
  }

  const token = readProperty(github, "token", "GitHub configuration") ??
    readEnvironmentValue("GITHUB_TOKEN") ?? "";
  const owner = readProperty(github, "owner", "GitHub configuration") ??
    readEnvironmentValue("GITHUB_OWNER") ?? "";
  const repo = readProperty(github, "repo", "GitHub configuration") ??
    readEnvironmentValue("GITHUB_REPO") ?? "";
  const ref = readProperty(github, "ref", "GitHub configuration") ??
    readEnvironmentValue("GITHUB_REF") ?? "main";

  return Object.freeze({
    github: {
      token: token as string,
      owner: owner as string,
      repo: repo as string,
      ref: ref as string,
      cache: readProperty(github, "cache", "GitHub configuration") as GitHubConfig["cache"],
      retry: readProperty(github, "retry", "GitHub configuration") as GitHubConfig["retry"],
    },
    projectDir: normalizeGitHubProjectDir(projectDirInput as string | undefined ?? ""),
  });
}

export class GitHubFSAdapter implements FSAdapter {
  readonly [FS_ADAPTER_KIND] = "github" as const;
  private readonly config: ResolvedGitHubConfig;
  private readonly client: GitHubApiClient;
  private readonly cache: FileCache;
  private readonly statOps: GitHubStatOperations;
  private readonly readOps: GitHubReadOperations;
  private readonly dirOps: GitHubDirectoryOperations;
  private readonly projectDir: string;

  private initialized = false;
  private lifecycleGeneration = 0;
  private initializationPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(adapterConfig: FSAdapterConfig) {
    const snapshot = snapshotAdapterConfig(adapterConfig);
    this.projectDir = snapshot.projectDir;
    this.config = createGitHubConfig(snapshot.github);
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

    logger.debug(`${LOG_PREFIX} Created adapter`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) {
      await this.initializationPromise;
      if (this.initialized) return;
    }

    logger.debug(`${LOG_PREFIX} Initializing`);

    const generation = this.lifecycleGeneration;
    const pending = (async () => {
      await this.statOps.buildIndex();
      if (generation === this.lifecycleGeneration) this.initialized = true;
    })();
    this.initializationPromise = pending;

    try {
      await pending;
      if (this.initialized) logger.debug(`${LOG_PREFIX} Initialized successfully`);
    } finally {
      if (this.initializationPromise === pending) this.initializationPromise = null;
    }
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

  async resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    await this.ensureInitialized();
    return this.statOps.resolveFile(basePath, options);
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

  getRateLimitInfo(): GitHubRateLimitInfo | null {
    return this.client.getRateLimitInfo();
  }

  async refreshSourceSnapshot(_reason = "manual-refresh"): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    const pending = this.performRefresh();
    this.refreshPromise = pending;
    try {
      await pending;
    } finally {
      if (this.refreshPromise === pending) this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<void> {
    const previousInitialization = this.initializationPromise;
    this.lifecycleGeneration++;
    this.initialized = false;
    this.readOps.invalidate();
    this.cache.clear();
    this.statOps.clearIndex();

    if (previousInitialization) {
      try {
        await previousInitialization;
      } catch {
        // A fresh snapshot can recover from a failed previous initialization.
      }
    }

    await this.initialize();
  }

  dispose(): void {
    this.lifecycleGeneration++;
    this.readOps.invalidate();
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
