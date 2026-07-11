/**
 * RSC Manifest Handler
 *
 * Handles client component manifest generation and caching.
 * Supports optional CacheRepository injection for testing.
 *
 * @module server/services/rsc/orchestrators/manifest-handler
 */

import { HASH_SEED_DJB2, RSC_MANIFEST_CACHE_TTL_MS } from "#veryfront/utils";
import { buildClientManifest } from "#veryfront/rendering/rsc/component-analyzer.ts";
import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import type { ManifestCacheEntry, ManifestData } from "./types.ts";
import {
  appendClientModuleVersion,
  buildClientModuleUrl,
} from "#veryfront/rendering/rsc/client-module-strategy.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

/** TTL in seconds for external cache repository */
const MANIFEST_CACHE_TTL_SECONDS = Math.floor(RSC_MANIFEST_CACHE_TTL_MS / 1000);
/** Cache key for manifest data */
export class ManifestHandler {
  private cache: ManifestCacheEntry | null = null;
  private generation = 0;
  private inFlightBuild: { generation: number; promise: Promise<ManifestData> } | null = null;
  private cacheMutation: Promise<void> = Promise.resolve();
  private readonly cacheRepo?: CacheRepository<string>;
  private readonly appDir: string;
  private readonly isLocalProject: boolean;
  private readonly cacheKey: string;
  private readonly fs?: FileSystemAdapter;

  constructor(
    private projectDir: string,
    options?: {
      cacheRepo?: CacheRepository<string>;
      appDir?: string;
      isLocalProject?: boolean;
      fs?: FileSystemAdapter;
      contentSourceId?: string;
    },
  ) {
    this.cacheRepo = options?.cacheRepo;
    this.appDir = options?.appDir ?? "app";
    this.isLocalProject = options?.isLocalProject ?? true;
    this.fs = options?.fs;
    this.cacheKey = [
      "rsc-manifest",
      this.isLocalProject ? "local" : "remote",
      this.appDir,
      options?.contentSourceId ?? "default",
    ].join(":");
  }

  async handle(clientManifest: Map<string, ClientComponentMeta> | null): Promise<Response> {
    while (true) {
      const generation = this.generation;
      await this.cacheMutation;
      if (generation !== this.generation) continue;

      const cachedData = await this.getCachedData();
      if (generation !== this.generation) continue;
      if (cachedData) return this.createResponse(cachedData);

      const data = await this.getOrStartBuild(clientManifest, generation);
      if (generation !== this.generation) continue;
      return this.createResponse(data);
    }
  }

  private getOrStartBuild(
    clientManifest: Map<string, ClientComponentMeta> | null,
    generation: number,
  ): Promise<ManifestData> {
    if (this.inFlightBuild?.generation === generation) return this.inFlightBuild.promise;

    const promise = this.buildAndPublish(clientManifest, generation);
    this.inFlightBuild = { generation, promise };
    const clearBuild = () => {
      if (this.inFlightBuild?.promise === promise) this.inFlightBuild = null;
    };
    void promise.then(clearBuild, clearBuild);
    return promise;
  }

  private async buildAndPublish(
    clientManifest: Map<string, ClientComponentMeta> | null,
    generation: number,
  ): Promise<ManifestData> {
    const data = await this.buildManifest(clientManifest);
    if (generation !== this.generation) return data;

    await this.enqueueCacheMutation(async () => {
      if (generation !== this.generation) return;
      await this.setCachedData(data);
      if (generation === this.generation) return;

      this.cache = null;
      await this.cacheRepo?.delete?.(this.cacheKey);
    });
    return data;
  }

  private async getCachedData(): Promise<ManifestData | null> {
    if (this.cacheRepo) {
      const cached = await this.cacheRepo.get(this.cacheKey);
      return cached ? (JSON.parse(cached) as ManifestData) : null;
    }

    if (!this.isCacheValid()) return null;
    return this.cache?.data ?? null;
  }

  private async setCachedData(data: ManifestData): Promise<void> {
    if (this.cacheRepo) {
      await this.cacheRepo.set(
        this.cacheKey,
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
    const manifest = clientManifest ??
      (await buildClientManifest(this.projectDir, this.appDir, this.fs));
    const components: Record<string, string> = {};
    const modules: ManifestData["modules"] = [];
    const graphIds: ManifestData["graphIds"] = { client: [], server: [] };
    const contentVersions: string[] = [];

    for (const [id, meta] of [...manifest].sort(([a], [b]) => a.localeCompare(b))) {
      const rel = meta.rel;
      if (!this.isLocalProject && !rel) {
        throw new Error(`Client component ${id} is missing its project-relative module path`);
      }

      const moduleUrl = this.isLocalProject
        ? appendClientModuleVersion(meta.path, meta.contentHash)
        : buildClientModuleUrl({
          strategy: "rsc-module",
          rel: rel!,
          version: meta.contentHash,
        });
      if (!moduleUrl) {
        throw new Error(`Client component ${id} has an invalid project-relative module path`);
      }

      const exportName = meta.exports.includes(id)
        ? id
        : meta.exports.includes("default")
        ? "default"
        : meta.exports[0] ?? "default";
      const graphRel = rel ?? meta.path;
      contentVersions.push(`${id}:${meta.contentHash ?? ""}`);

      components[id] = moduleUrl;
      modules.push({
        id,
        clientRef: `${moduleUrl}#${exportName}`,
        exports: meta.exports,
      });
      graphIds.client.push({
        id,
        path: this.isLocalProject ? (meta.sourcePath ?? meta.path) : graphRel,
        rel: graphRel,
      });
    }

    return {
      version: 1,
      hash: hashManifest(graphIds.client, modules, contentVersions),
      components,
      modules,
      graphIds,
    };
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
    this.generation++;
    this.inFlightBuild = null;
    this.cache = null;
    void this.enqueueCacheMutation(async () => {
      this.cache = null;
      await this.cacheRepo?.delete?.(this.cacheKey);
    });
  }

  private enqueueCacheMutation(operation: () => Promise<void>): Promise<void> {
    const mutation = this.cacheMutation.then(operation, operation);
    this.cacheMutation = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }
}

function hashManifest(
  graphIds: ManifestData["graphIds"]["client"],
  modules: ManifestData["modules"],
  contentVersions: string[],
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ graphIds, modules, contentVersions }),
  );
  let hash = HASH_SEED_DJB2;
  for (const byte of bytes) hash = ((hash << 5) + hash) ^ byte;
  return (hash >>> 0).toString(16);
}
