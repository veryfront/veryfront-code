import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MdxBundle, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import { getProviderEntities } from "../../core/types/entities/getEntityInfo.ts";

export interface ProviderManagerOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
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
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;

  constructor(options: ProviderManagerOptions) {
    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.compileMDX = options.compileMDX;
  }

  async collectProviders(): Promise<ProviderCollectionResult> {
    const providerInfos = await this.discoverProviders();
    const { providerBundles, providerItems } = await this.compileProviders(providerInfos);

    logger.debug("[ProviderManager] Collected providers", {
      count: providerInfos.length,
      providers: providerInfos.map((p) => p.entity.id),
    });

    return { providerBundles, providerItems, providerInfos };
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
