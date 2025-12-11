import { logger } from "@veryfront/utils";
import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./types.ts";
import type { FileInfo } from "../base.ts";
import { VeryfrontAPIClient } from "../veryfront-api-client.ts";
import type { Project } from "../veryfront-api-client.ts";
import { FileCache } from "../file-cache/file-cache.ts";
import type { FileCacheOptions } from "../file-cache/types.ts";
import { type CacheStats, createVeryfrontConfig } from "./types.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { ReadOperations } from "./read-operations.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { StatOperations } from "./stat-operations.ts";

export class VeryfrontFSAdapter implements FSAdapter {
  private client: VeryfrontAPIClient;
  private cache: FileCache;
  private normalizer: PathNormalizer;
  private readOps: ReadOperations;
  private dirOps: DirectoryOperations;
  private statOps: StatOperations;
  private initialized = false;
  private projectData?: Project;

  constructor(config: FSAdapterConfig) {
    const veryfrontConfig = createVeryfrontConfig(config);

    this.client = new VeryfrontAPIClient({
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      apiToken: veryfrontConfig.apiToken,
      projectSlug: veryfrontConfig.projectSlug,
      retry: veryfrontConfig.retry,
    });

    this.cache = new FileCache(veryfrontConfig.cache as FileCacheOptions);
    this.normalizer = new PathNormalizer(config.projectDir);
    this.readOps = new ReadOperations(this.client, this.cache, this.normalizer);
    this.dirOps = new DirectoryOperations(this.client, this.cache, this.normalizer);
    this.statOps = new StatOperations(this.client, this.cache, this.normalizer);

    logger.info("[VeryfrontFSAdapter] Created", {
      apiBaseUrl: veryfrontConfig.apiBaseUrl,
      projectSlug: veryfrontConfig.projectSlug,
      cacheEnabled: veryfrontConfig.cache.enabled,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("[VeryfrontFSAdapter] Initializing...");

    await this.client.initialize();

    const projectId = this.client.getProjectId();
    this.projectData = await this.client.getProject(projectId);

    logger.info("[VeryfrontFSAdapter] Project data fetched", {
      provider: this.projectData.provider,
      layout: this.projectData.layout,
    });

    const cacheKey = "files:all";
    logger.debug("[VeryfrontFSAdapter] Fetching all files from API");
    const files = await this.client.listAllFiles();
    this.cache.set(cacheKey, files);

    logger.debug("[VeryfrontFSAdapter] Fetched files during initialization", {
      count: files.length,
    });

    this.initialized = true;
    logger.info("[VeryfrontFSAdapter] Initialized", {
      projectId: this.client.getProjectId(),
      files: files.length,
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.readOps.readFile(path);
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.readOps.readTextFile(path);
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    await this.ensureInitialized();
    return this.dirOps.readdir(path);
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    return this.statOps.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.statOps.exists(path);
  }

  dispose(): void {
    this.cache.clear();
    this.initialized = false;
    logger.info("[VeryfrontFSAdapter] Disposed");
  }

  getCacheStats(): CacheStats {
    return {
      cache: this.cache.stats(),
    };
  }

  getProjectData(): Project | undefined {
    return this.projectData;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
