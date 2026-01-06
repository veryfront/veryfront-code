import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MdxBundle, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { getProviderEntities } from "../../core/types/entities/getEntityInfo.ts";
import { join } from "../../platform/compat/path-helper.ts";

interface VeryfrontFSAdapterLike {
  getProjectData: () => { provider?: string; layout?: string } | undefined;
  exists: (path: string) => Promise<boolean>;
  getFilePathByEntityId?: (entityId: string) => string | undefined;
}

interface MultiProjectFSAdapterLike {
  getProjectData: () => Promise<{ provider?: string; layout?: string } | undefined>;
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

export class ProviderManager {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config?: VeryfrontConfig;
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
  private cachedResult: ProviderCollectionResult | null = null;

  constructor(options: ProviderManagerOptions) {
    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.config = options.config;
    this.compileMDX = options.compileMDX;
  }

  clearCache(): void {
    this.cachedResult = null;
  }

  async collectProviders(): Promise<ProviderCollectionResult> {
    logger.info("[ProviderManager] collectProviders called");
    if (this.cachedResult) {
      logger.info("[ProviderManager] Using cached providers");
      return this.cachedResult;
    }
    const providerItems: ProviderItem[] = [];
    const providerBundles: MdxBundle[] = [];
    const providerInfos: EntityInfo[] = [];

    // Priority 1: Check config.provider from veryfront.config.ts
    const configProviderItem = await this.collectConfigProvider();
    if (configProviderItem) {
      providerItems.push(configProviderItem);
      logger.debug("[ProviderManager] Using config.provider", {
        path: configProviderItem.componentPath,
      });
      const result = { providerBundles, providerItems, providerInfos };
      this.cachedResult = result;
      return result;
    }

    // Priority 2: Check project data provider (legacy API)
    const apiProviderItem = await this.collectAPIProvider();
    if (apiProviderItem) {
      providerItems.push(apiProviderItem);
      logger.debug("[ProviderManager] Using API project provider", {
        path: apiProviderItem.componentPath,
      });
      const result = { providerBundles, providerItems, providerInfos };
      this.cachedResult = result;
      return result;
    }

    // Priority 3: Default discovery from providers/ and components/ directories
    const discoveredInfos = await this.discoverProviders();
    const compiled = await this.compileProviders(discoveredInfos);

    logger.debug("[ProviderManager] Collected providers", {
      count: discoveredInfos.length,
      providers: discoveredInfos.map((p) => p.entity.id),
    });

    const result = {
      providerBundles: compiled.providerBundles,
      providerItems: compiled.providerItems,
      providerInfos: discoveredInfos,
    };
    this.cachedResult = result;
    return result;
  }

  private isValidProviderPath(provider: string): boolean {
    return /\.(tsx|jsx|ts|js|mdx)$/.test(provider);
  }

  private isUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

    logger.debug("[ProviderManager] Checking config.provider", {
      configProvider,
      providerPath,
      exists,
    });

    if (!exists) {
      return null;
    }

    return {
      kind: "tsx",
      componentPath: providerPath,
      path: providerPath,
    };
  }

  private async collectAPIProvider(): Promise<ProviderItem | null> {
    logger.info("[ProviderManager] collectAPIProvider called");
    const vfAdapter = getVeryfrontFSAdapter(this.adapter);
    if (!vfAdapter) {
      logger.info("[ProviderManager] No VeryfrontFSAdapter found");
      return null;
    }

    // getProjectData() may be async (MultiProjectFSAdapter) or sync (VeryfrontFSAdapter)
    const projectDataResult = vfAdapter.getProjectData();
    const projectData = projectDataResult instanceof Promise
      ? await projectDataResult
      : projectDataResult;
    logger.info("[ProviderManager] Project data", { projectData });

    let providerValue = projectData?.provider;

    // If provider is a UUID, try to resolve it to a file path via entity lookup
    if (providerValue && this.isUUID(providerValue)) {
      // getFilePathByEntityId may be async (MultiProjectFSAdapter) or sync (VeryfrontFSAdapter)
      const resolvedPathResult = vfAdapter.getFilePathByEntityId?.(providerValue);
      const resolvedPath = resolvedPathResult instanceof Promise
        ? await resolvedPathResult
        : resolvedPathResult;
      if (resolvedPath) {
        logger.info("[ProviderManager] Resolved UUID provider to path", {
          uuid: providerValue,
          path: resolvedPath,
        });
        providerValue = resolvedPath.replace(/^components\//, "");
      } else {
        logger.info("[ProviderManager] Could not resolve UUID provider", {
          uuid: providerValue,
        });
      }
    }

    if (!providerValue || !this.isValidProviderPath(providerValue)) {
      logger.info("[ProviderManager] Skipping invalid API provider value", {
        provider: projectData?.provider,
        resolved: providerValue,
      });
      return null;
    }

    // First try components/ directory (legacy convention)
    let providerPath = join(this.projectDir, "components", providerValue);
    let exists = await vfAdapter.exists(providerPath);

    logger.info("[ProviderManager] Checking API project provider (components/)", {
      provider: projectData?.provider,
      providerPath,
      exists,
    });

    // If not in components/, try project root (app.mdx convention)
    if (!exists) {
      providerPath = join(this.projectDir, providerValue);
      exists = await vfAdapter.exists(providerPath);
      logger.info("[ProviderManager] Checking API project provider (root)", {
        provider: providerValue,
        providerPath,
        exists,
      });
    }

    if (!exists) {
      return null;
    }

    // Determine kind based on file extension
    const kind = providerPath.endsWith(".mdx") ? "mdx" : "tsx";

    // For MDX providers, we need to compile them
    if (kind === "mdx") {
      try {
        const content = await this.adapter.fs.readFile(providerPath);
        const bundle = await this.compileMDX(
          content as string,
          { isProvider: true },
          providerPath,
        );
        logger.info("[ProviderManager] Compiled API MDX provider", {
          path: providerPath,
          hasCompiledCode: !!bundle?.compiledCode,
        });
        return {
          kind,
          componentPath: providerPath,
          path: providerPath,
          bundle,
        };
      } catch (error) {
        logger.error("[ProviderManager] Failed to compile API MDX provider", {
          path: providerPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    return {
      kind,
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
