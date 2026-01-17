import { parallelMap, rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "@veryfront/platform/adapters/fs/wrapper.ts";
import type { MdxBundle, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { getProviderEntities } from "@veryfront/types/entities/getEntityInfo.ts";
import { join } from "@veryfront/platform/compat/path-helper.ts";
import { getProjectScopedKeyAlways } from "@veryfront/cache/cache-key-builder.ts";

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

  if (!isExtendedFSAdapter(fs) || !fs.isVeryfrontAdapter()) {
    return null;
  }

  const wrapped = fs.getUnderlyingAdapter();
  if (!wrapped || typeof wrapped !== "object") return null;

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
    // Use project-scoped key for proper isolation in multi-project mode
    const fallbackKey = projectData?.id || projectData?.slug || ProviderManager.DEFAULT_CACHE_KEY;
    const scopedKey = getProjectScopedKeyAlways("veryfront:provider", fallbackKey);
    return scopedKey || fallbackKey;
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
      logger.debug("[ProviderManager] Stale cache, refreshing in background", logCtx);
      this.refreshInBackground(cacheKey, projectData, route);
      return cachedEntry.result;
    }

    // No cache or already refreshing - fetch synchronously
    logger.debug("[ProviderManager] Cache miss", logCtx);
    return this.fetchProviders(cacheKey, projectData, route);
  }

  private refreshInBackground(
    cacheKey: string,
    projectData: ProjectData | undefined,
    route?: string,
  ): void {
    this.refreshing.add(cacheKey);
    const logCtx = this.getLogContext(projectData, route);
    this.fetchProviders(cacheKey, projectData, route)
      .catch((error) => {
        logger.error("[ProviderManager] Background refresh failed", { ...logCtx, error });
      })
      .finally(() => {
        this.refreshing.delete(cacheKey);
      });
  }

  private async fetchProviders(
    cacheKey: string,
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
      logger.debug("[ProviderManager] Fetched provider (config)", {
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
      logger.debug("[ProviderManager] No providers found", {
        ...logCtx,
        durationMs: Date.now() - startTime,
      });
    } else {
      logger.debug("[ProviderManager] Fetched providers (discovery)", {
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
    // Separate MDX and TSX providers
    const mdxProviders = providerInfos.filter((p) => (p.entity.kind || "mdx") === "mdx");
    const tsxProviders = providerInfos.filter((p) => p.entity.kind === "tsx");

    // Log TSX providers being skipped
    for (const providerInfo of tsxProviders) {
      logger.debug("[ProviderManager] Skipping MDX compilation for TSX provider", {
        providerPath: providerInfo.entity.path,
      });
    }

    // Compile all MDX providers in parallel with concurrency control
    const compiledMdx = await parallelMap(mdxProviders, async (providerInfo) => {
      try {
        const bundle = await this.compileProvider(providerInfo);
        return { providerInfo, bundle, error: null };
      } catch (error) {
        logger.error("[ProviderManager] Failed to compile provider", {
          providerPath: providerInfo.entity.path,
          error,
        });
        return { providerInfo, bundle: null, error };
      }
    });

    // Check for any errors and throw the first one
    const firstError = compiledMdx.find((r) => r.error);
    if (firstError) {
      throw firstError.error;
    }

    // Build results
    const providerBundles: MdxBundle[] = [];
    const providerItems: ProviderItem[] = [];

    // Add MDX providers
    for (const { providerInfo, bundle } of compiledMdx) {
      if (bundle) {
        providerBundles.push(bundle);
        providerItems.push({
          kind: "mdx",
          bundle,
          componentPath: providerInfo.entity.path,
          path: providerInfo.entity.path,
          entityInfo: providerInfo,
        });
      }
    }

    // Add TSX providers
    for (const providerInfo of tsxProviders) {
      providerItems.push({
        kind: "tsx",
        componentPath: providerInfo.entity.path,
        path: providerInfo.entity.path,
        entityInfo: providerInfo,
      });
    }

    return { providerBundles, providerItems };
  }

  private async compileProvider(providerInfo: EntityInfo): Promise<MdxBundle> {
    logger.debug("[ProviderManager] Compiling MDX provider", {
      providerPath: providerInfo.entity.path,
      contentLength: providerInfo.entity.content.length,
    });

    const bundle = await this.compileMDX(
      providerInfo.entity.content,
      { ...providerInfo.entity.frontmatter, isProvider: true },
      providerInfo.entity.path,
    );

    logger.debug("[ProviderManager] MDX provider compiled", {
      providerPath: providerInfo.entity.path,
      codeLength: bundle.compiledCode?.length,
    });

    return bundle;
  }
}
