import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MdxBundle, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { getProviderEntities } from "../../core/types/entities/getEntityInfo.ts";
import { join } from "../../platform/compat/path-helper.ts";

interface ProjectData {
  id?: string;
  slug?: string;
  provider?: string;
  layout?: string;
}

interface VeryfrontFSAdapterLike {
  getProjectData: () => ProjectData | undefined;
  exists: (path: string) => Promise<boolean>;
  getFilePathByEntityId?: (entityId: string) => string | undefined;
}

interface MultiProjectFSAdapterLike {
  getProjectData: () => Promise<ProjectData | undefined>;
  exists: (path: string) => Promise<boolean>;
  getFilePathByEntityId?: (entityId: string) => Promise<string | undefined>;
}

type FSAdapterLike = VeryfrontFSAdapterLike | MultiProjectFSAdapterLike;

function getVeryfrontFSAdapter(adapter: RuntimeAdapter): FSAdapterLike | null {
  const fs = adapter?.fs;
  if (!fs || typeof fs !== "object") return null;

  const wrapped = (fs as { fsAdapter?: unknown }).fsAdapter;
  if (!wrapped || typeof wrapped !== "object") return null;

  const constructor = (wrapped as { constructor?: { name?: string } }).constructor;
  const adapterName = constructor?.name;

  // Support both VeryfrontFSAdapter (single-project) and MultiProjectFSAdapter (proxy mode)
  if (adapterName !== "VeryfrontFSAdapter" && adapterName !== "MultiProjectFSAdapter") {
    return null;
  }

  const typedAdapter = wrapped as Partial<FSAdapterLike>;
  if (typeof typedAdapter.getProjectData !== "function") return null;
  if (typeof typedAdapter.exists !== "function") return null;

  return typedAdapter as FSAdapterLike;
}

export interface ProviderManagerOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
}

export interface ProviderCollectionResult {
  providerBundles: MdxBundle[];
  providerItems: ProviderItem[];
  providerInfos: EntityInfo[];
}

interface CacheEntry {
  result: ProviderCollectionResult;
  timestamp: number;
}

export class ProviderManager {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config?: VeryfrontConfig;
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
  // Cache is keyed by project ID to support multi-project proxy mode
  private cache: Map<string, CacheEntry> = new Map();
  // Track in-flight refreshes to avoid duplicate work
  private refreshing: Set<string> = new Set();
  private static DEFAULT_CACHE_KEY = "__default__";
  // Cache TTL: 30 minutes (stale-while-revalidate makes this safe)
  private static CACHE_TTL_MS = 30 * 60 * 1000;

  constructor(options: ProviderManagerOptions) {
    // Sanity checks - warn early if misconfigured
    if (!options.projectDir) {
      logger.warn("[ProviderManager] Initialized with empty projectDir");
    }
    if (!options.adapter) {
      logger.warn("[ProviderManager] Initialized without adapter");
    }
    if (!options.compileMDX) {
      logger.warn("[ProviderManager] Initialized without compileMDX function");
    }

    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.config = options.config;
    this.compileMDX = options.compileMDX;
  }

  clearCache(projectId?: string): void {
    if (projectId) {
      this.cache.delete(projectId);
    } else {
      this.cache.clear();
    }
  }

  private getCacheKey(projectData?: ProjectData): string {
    return projectData?.id || projectData?.slug || ProviderManager.DEFAULT_CACHE_KEY;
  }

  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < ProviderManager.CACHE_TTL_MS;
  }

  private getLogContext(
    projectData?: ProjectData,
    route?: string,
  ): Record<string, string | undefined> {
    return {
      projectId: projectData?.id,
      projectSlug: projectData?.slug,
      route,
    };
  }

  async collectProviders(route?: string): Promise<ProviderCollectionResult> {
    const startTime = Date.now();

    // Get project data first to determine cache key
    const vfAdapter = getVeryfrontFSAdapter(this.adapter);
    let projectData: ProjectData | undefined;
    if (vfAdapter) {
      const projectDataResult = vfAdapter.getProjectData();
      projectData = projectDataResult instanceof Promise
        ? await projectDataResult
        : projectDataResult;
    }
    const cacheKey = this.getCacheKey(projectData);

    // Check cache with project-specific key
    const cachedEntry = this.cache.get(cacheKey);

    const logCtx = this.getLogContext(projectData, route);

    // If cache is valid, return immediately
    if (cachedEntry && this.isCacheValid(cachedEntry)) {
      logger.debug("[ProviderManager] Cache hit", {
        ...logCtx,
        durationMs: Date.now() - startTime,
      });
      return cachedEntry.result;
    }

    // Stale-while-revalidate: if we have stale cache, return it and refresh in background
    if (cachedEntry && !this.refreshing.has(cacheKey)) {
      logger.info("[ProviderManager] Stale cache, refreshing in background", logCtx);
      this.refreshInBackground(cacheKey, vfAdapter, projectData, route);
      return cachedEntry.result;
    }

    // No cache or already refreshing - fetch synchronously
    logger.info("[ProviderManager] Cache miss", logCtx);
    return this.fetchProviders(cacheKey, vfAdapter, projectData, route);
  }

  private refreshInBackground(
    cacheKey: string,
    vfAdapter: FSAdapterLike | null,
    projectData: ProjectData | undefined,
    route?: string,
  ): void {
    this.refreshing.add(cacheKey);
    const logCtx = this.getLogContext(projectData, route);
    this.fetchProviders(cacheKey, vfAdapter, projectData, route)
      .catch((error) => {
        logger.error("[ProviderManager] Background refresh failed", { ...logCtx, error });
      })
      .finally(() => {
        this.refreshing.delete(cacheKey);
      });
  }

  private async fetchProviders(
    cacheKey: string,
    vfAdapter: FSAdapterLike | null,
    projectData: ProjectData | undefined,
    route?: string,
  ): Promise<ProviderCollectionResult> {
    const startTime = Date.now();
    const logCtx = this.getLogContext(projectData, route);
    const providerItems: ProviderItem[] = [];
    const providerBundles: MdxBundle[] = [];
    const providerInfos: EntityInfo[] = [];

    // Priority 1: Check config.provider from veryfront.config.ts
    const configProviderItem = await this.collectConfigProvider();
    if (configProviderItem) {
      providerItems.push(configProviderItem);
      const result = { providerBundles, providerItems, providerInfos };
      this.cache.set(cacheKey, { result, timestamp: Date.now() });
      logger.info("[ProviderManager] Fetched provider (config)", {
        ...logCtx,
        providerPath: configProviderItem.componentPath,
        durationMs: Date.now() - startTime,
      });
      return result;
    }

    // Priority 2: Default discovery from providers/ and components/ directories
    const discoveredInfos = await this.discoverProviders();
    const compiled = await this.compileProviders(discoveredInfos);

    const result = {
      providerBundles: compiled.providerBundles,
      providerItems: compiled.providerItems,
      providerInfos: discoveredInfos,
    };
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    if (discoveredInfos.length === 0) {
      logger.info("[ProviderManager] No providers found", {
        ...logCtx,
        durationMs: Date.now() - startTime,
      });
    } else {
      logger.info("[ProviderManager] Fetched providers (discovery)", {
        ...logCtx,
        count: discoveredInfos.length,
        durationMs: Date.now() - startTime,
      });
    }
    return result;
  }

  private isValidProviderPath(provider: string): boolean {
    return /\.(tsx|jsx|ts|js|mdx)$/.test(provider);
  }

  private async collectConfigProvider(): Promise<ProviderItem | null> {
    // Check both config.provider and config.app (app is an alias for provider/wrapper component)
    const configProvider = this.config?.provider || this.config?.app;
    if (!configProvider || !this.isValidProviderPath(configProvider)) {
      return null;
    }

    const providerPath =
      configProvider.startsWith("/") || configProvider.startsWith(this.projectDir)
        ? configProvider
        : join(this.projectDir, configProvider);

    const exists = await this.adapter.fs.exists(providerPath);

    if (!exists) {
      logger.warn("[ProviderManager] Config provider specified but file not found", {
        configProvider,
        providerPath,
      });
      return null;
    }

    return {
      kind: "tsx",
      componentPath: providerPath,
      path: providerPath,
    };
  }

  private async discoverProviders(): Promise<EntityInfo[]> {
    const providerInfos = await getProviderEntities(this.projectDir, this.adapter);

    logger.debug("[ProviderManager] Discovered providers", {
      count: providerInfos.length,
    });

    return providerInfos;
  }

  private async compileProviders(
    providerInfos: EntityInfo[],
  ): Promise<{ providerBundles: MdxBundle[]; providerItems: ProviderItem[] }> {
    const providerBundles: MdxBundle[] = [];
    const providerItems: ProviderItem[] = [];

    for (const providerInfo of providerInfos) {
      try {
        const kind = providerInfo.entity.kind || "mdx";

        if (kind === "mdx") {
          const bundle = await this.compileProvider(providerInfo);
          providerBundles.push(bundle);

          providerItems.push({
            kind: "mdx",
            bundle,
            componentPath: providerInfo.entity.id,
            path: providerInfo.entity.id,
            entityInfo: providerInfo,
          });
        } else {
          logger.debug("[ProviderManager] Skipping MDX compilation for TSX provider", {
            providerId: providerInfo.entity.id,
          });

          providerItems.push({
            kind: "tsx",
            componentPath: providerInfo.entity.id,
            path: providerInfo.entity.id,
            entityInfo: providerInfo,
          });
        }
      } catch (error) {
        logger.error("[ProviderManager] Failed to compile provider", {
          providerId: providerInfo.entity.id,
          error,
        });
        throw error;
      }
    }

    return { providerBundles, providerItems };
  }

  private async compileProvider(providerInfo: EntityInfo): Promise<MdxBundle> {
    logger.debug("[ProviderManager] Compiling MDX provider", {
      providerId: providerInfo.entity.id,
      contentLength: providerInfo.entity.content.length,
    });

    const bundle = await this.compileMDX(
      providerInfo.entity.content,
      { ...providerInfo.entity.frontmatter, isProvider: true },
      providerInfo.entity.id,
    );

    logger.debug("[ProviderManager] MDX provider compiled", {
      providerId: providerInfo.entity.id,
      codeLength: bundle.compiledCode?.length,
    });

    return bundle;
  }
}
