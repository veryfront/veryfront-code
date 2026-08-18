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
  appendClientModuleDependencyPins,
  appendClientModuleVersion,
  buildClientModuleUrl,
} from "#veryfront/rendering/rsc/client-module-strategy.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { getDependencyPinningCacheKey } from "#veryfront/transforms/esm/package-registry.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

/** TTL in seconds for external cache repository */
const MANIFEST_CACHE_TTL_SECONDS = Math.floor(RSC_MANIFEST_CACHE_TTL_MS / 1000);
const MANIFEST_TRACKED_CACHE_KEYS_MAX = 64;
/** Cache key for manifest data */
export class ManifestHandler {
  private cache: ManifestCacheEntry | null = null;
  private generation = 0;
  private inFlightBuild: {
    generation: number;
    dependencyPinningCacheKey: string;
    promise: Promise<ManifestData>;
  } | null = null;
  private cacheMutation: Promise<void> = Promise.resolve();
  private readonly cacheRepo?: CacheRepository<string>;
  private readonly appDir: string;
  private readonly isLocalProject: boolean;
  private readonly cacheKey: string;
  private readonly knownCacheKeys = new Set<string>();
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
    // Defaults to remote. Local mode exposes `meta.sourcePath` instead of the
    // graph-relative path and emits filesystem client module URLs, so an
    // omitted flag must not hand a hosted project the local shape.
    this.isLocalProject = options?.isLocalProject ?? false;
    this.fs = options?.fs;
    this.cacheKey = [
      "rsc-manifest",
      this.isLocalProject ? "local" : "remote",
      this.appDir,
      options?.contentSourceId ?? "default",
    ].join(":");
  }

  async handle(
    clientManifest: Map<string, ClientComponentMeta> | null,
    dependencyPinningCacheKey?: string,
  ): Promise<Response> {
    const pinKey = dependencyPinningCacheKey ??
      await getDependencyPinningCacheKey(this.projectDir);
    while (true) {
      const generation = this.generation;
      await this.cacheMutation;
      if (generation !== this.generation) continue;

      const cachedData = await this.getCachedData(pinKey);
      if (generation !== this.generation) continue;
      if (cachedData) return this.createResponse(cachedData);

      const data = await this.getOrStartBuild(clientManifest, generation, pinKey);
      if (generation !== this.generation) continue;
      return this.createResponse(data);
    }
  }

  private getOrStartBuild(
    clientManifest: Map<string, ClientComponentMeta> | null,
    generation: number,
    dependencyPinningCacheKey: string,
  ): Promise<ManifestData> {
    if (
      this.inFlightBuild?.generation === generation &&
      this.inFlightBuild.dependencyPinningCacheKey === dependencyPinningCacheKey
    ) {
      return this.inFlightBuild.promise;
    }

    const promise = this.buildAndPublish(
      clientManifest,
      generation,
      dependencyPinningCacheKey,
    );
    this.inFlightBuild = { generation, dependencyPinningCacheKey, promise };
    const clearBuild = () => {
      if (this.inFlightBuild?.promise === promise) this.inFlightBuild = null;
    };
    void promise.then(clearBuild, clearBuild);
    return promise;
  }

  private async buildAndPublish(
    clientManifest: Map<string, ClientComponentMeta> | null,
    generation: number,
    dependencyPinningCacheKey: string,
  ): Promise<ManifestData> {
    const data = await this.buildManifest(clientManifest, dependencyPinningCacheKey);
    if (generation !== this.generation) return data;

    await this.enqueueCacheMutation(async () => {
      if (generation !== this.generation) return;
      await this.setCachedData(data, dependencyPinningCacheKey);
      if (generation === this.generation) return;

      this.cache = null;
      await this.cacheRepo?.delete?.(this.scopedCacheKey(dependencyPinningCacheKey));
    });
    return data;
  }

  private async getCachedData(dependencyPinningCacheKey: string): Promise<ManifestData | null> {
    if (this.cacheRepo) {
      const cached = await this.cacheRepo.get(
        this.scopedCacheKey(dependencyPinningCacheKey),
      );
      return cached ? (JSON.parse(cached) as ManifestData) : null;
    }

    if (!this.isCacheValid(dependencyPinningCacheKey)) return null;
    return this.cache?.data ?? null;
  }

  private async setCachedData(
    data: ManifestData,
    dependencyPinningCacheKey: string,
  ): Promise<void> {
    if (this.cacheRepo) {
      const scopedKey = this.scopedCacheKey(dependencyPinningCacheKey);
      await this.cacheRepo.set(
        scopedKey,
        JSON.stringify(data),
        MANIFEST_CACHE_TTL_SECONDS,
      );
      this.knownCacheKeys.add(scopedKey);
      if (this.knownCacheKeys.size > MANIFEST_TRACKED_CACHE_KEYS_MAX) {
        const oldestKey = this.knownCacheKeys.values().next().value;
        if (oldestKey !== undefined) {
          this.knownCacheKeys.delete(oldestKey);
          await this.cacheRepo.delete?.(oldestKey);
        }
      }
      return;
    }

    this.cache = { data, timestamp: Date.now(), dependencyPinningCacheKey };
  }

  private isCacheValid(dependencyPinningCacheKey: string): boolean {
    return this.cache !== null &&
      this.cache.dependencyPinningCacheKey === dependencyPinningCacheKey &&
      Date.now() - this.cache.timestamp < RSC_MANIFEST_CACHE_TTL_MS;
  }

  private async buildManifest(
    clientManifest: Map<string, ClientComponentMeta> | null,
    dependencyPinningCacheKey: string,
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
        ? appendClientModuleDependencyPins(
          appendClientModuleVersion(meta.path, meta.contentHash),
          dependencyPinningCacheKey,
        )
        : buildClientModuleUrl({
          strategy: "rsc-module",
          rel: rel!,
          version: meta.contentHash,
          dependencyPinningCacheKey,
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
      hash: hashManifest(
        graphIds.client,
        modules,
        contentVersions,
        dependencyPinningCacheKey,
      ),
      ...(dependencyPinningCacheKey.startsWith("on:") ? { dependencyPinningCacheKey } : {}),
      components,
      modules,
      graphIds,
    };
  }

  private createResponse(data: ManifestData): Response {
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "cache-control": "private, no-cache, must-revalidate",
        vary: RSC_DEPENDENCY_PINNING_HEADER,
      },
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
      await Promise.all(
        [...this.knownCacheKeys].map((key) => this.cacheRepo?.delete?.(key)),
      );
      this.knownCacheKeys.clear();
    });
  }

  private scopedCacheKey(dependencyPinningCacheKey: string): string {
    return dependencyPinningCacheKey.startsWith("on:")
      ? `${this.cacheKey}:pins:${dependencyPinningCacheKey}`
      : this.cacheKey;
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
  dependencyPinningCacheKey: string,
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      graphIds,
      modules,
      contentVersions,
      ...(dependencyPinningCacheKey.startsWith("on:") ? { dependencyPinningCacheKey } : {}),
    }),
  );
  let hash = HASH_SEED_DJB2;
  for (const byte of bytes) hash = ((hash << 5) + hash) ^ byte;
  return (hash >>> 0).toString(16);
}
