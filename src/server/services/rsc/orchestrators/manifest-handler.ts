/**
 * RSC Manifest Handler
 *
 * Handles client component manifest generation and caching.
 * Supports optional CacheRepository injection for testing.
 *
 * @module server/services/rsc/orchestrators/manifest-handler
 */

import { RSC_MANIFEST_CACHE_TTL_MS } from "#veryfront/utils";
import { buildClientManifest } from "#veryfront/rendering/rsc/component-analyzer.ts";
import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import type { ManifestCacheEntry, ManifestData } from "./types.ts";

/** TTL in seconds for external cache repository */
const MANIFEST_CACHE_TTL_SECONDS = Math.floor(RSC_MANIFEST_CACHE_TTL_MS / 1000);
/** Cache key for manifest data */
const MANIFEST_CACHE_KEY = "rsc-manifest";

export class ManifestHandler {
  private cache: ManifestCacheEntry | null = null;
  private readonly cacheRepo?: CacheRepository<string>;

  constructor(
    private projectDir: string,
    options?: { cacheRepo?: CacheRepository<string> },
  ) {
    this.cacheRepo = options?.cacheRepo;
  }

  async handle(clientManifest: Map<string, ClientComponentMeta> | null): Promise<Response> {
    const cachedData = await this.getCachedData();
    if (cachedData) return this.createResponse(cachedData);

    const data = await this.buildManifest(clientManifest);
    await this.setCachedData(data);

    return this.createResponse(data);
  }

  private async getCachedData(): Promise<ManifestData | null> {
    if (this.cacheRepo) {
      const cached = await this.cacheRepo.get(MANIFEST_CACHE_KEY);
      return cached ? (JSON.parse(cached) as ManifestData) : null;
    }

    if (!this.isCacheValid()) return null;
    return this.cache?.data ?? null;
  }

  private async setCachedData(data: ManifestData): Promise<void> {
    if (this.cacheRepo) {
      await this.cacheRepo.set(
        MANIFEST_CACHE_KEY,
        JSON.stringify(data),
        MANIFEST_CACHE_TTL_SECONDS,
      );
      return;
    }

    this.cache = { data, timestamp: Date.now() };
  }

  private isCacheValid(): boolean {
    return this.cache !== null && Date.now() - this.cache.timestamp < RSC_MANIFEST_CACHE_TTL_MS;
  }

  private async buildManifest(
    clientManifest: Map<string, ClientComponentMeta> | null,
  ): Promise<ManifestData> {
    const manifest = clientManifest ?? (await buildClientManifest(this.projectDir));
    const components: Record<string, string> = {};

    for (const [id, meta] of manifest) {
      components[id] = meta.path;
    }

    return { components };
  }

  private createResponse(data: ManifestData): Response {
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  }

  /**
   * Clear the manifest cache.
   * Useful for testing or forcing rebuild.
   */
  clearCache(): void {
    this.cache = null;
    void this.cacheRepo?.delete?.(MANIFEST_CACHE_KEY);
  }
}
