import * as React from "react";
import type { EntityInfo } from "@veryfront/types";
import type { LayoutItem, MdxBundle, MDXComponents, ProviderItem } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { LayoutApplicator } from "../layouts/index.ts";
import { createDefaultMDXComponents } from "../utils/index.ts";
import type { LayoutCollector, LayoutCompiler, ProviderManager } from "../layouts/index.ts";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { clearSSRModuleCache } from "@veryfront/modules/react-loader/index.ts";

export interface LayoutOrchestratorConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
  moduleServerUrl?: string;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  providerManager: ProviderManager;
  layoutCache: LayoutComponentCache;
  componentRegistry: MDXComponents;
}

export interface LayoutCollectionResult {
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
}

export interface ProviderCollectionResult {
  providerBundles: MdxBundle[];
  providerItems: ProviderItem[];
  providerInfos: EntityInfo[];
}

export class LayoutOrchestrator {
  private config: LayoutOrchestratorConfig;

  constructor(config: LayoutOrchestratorConfig) {
    this.config = config;
  }

  clearCache(): void {
    this.config.layoutCache.clear();
    clearSSRModuleCache();
  }

  async collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult> {
    const result = await this.config.layoutCollector.collectLayouts(pageInfo);
    await this.config.layoutCompiler.compileLayouts(result.nestedLayouts);
    return result;
  }

  async collectProviders(): Promise<ProviderCollectionResult> {
    return await this.config.providerManager.collectProviders();
  }

  async applyLayoutsAndWrappers(
    pageElement: React.ReactElement,
    pageInfo: EntityInfo,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<React.ReactElement> {
    const defaultComponents = createDefaultMDXComponents();
    const mergedComponents = { ...defaultComponents, ...this.config.componentRegistry };

    const layoutApplicator = new LayoutApplicator({
      projectDir: this.config.projectDir,
      adapter: this.config.adapter,
      config: this.config.config,
      layoutCache: this.config.layoutCache,
      mergedComponents,
      mode: this.config.mode,
      moduleServerUrl: this.config.moduleServerUrl,
    });

    return await layoutApplicator.applyLayouts(
      pageElement,
      pageInfo,
      layoutBundle,
      nestedLayouts,
      providerItems,
      layoutDataMap,
    );
  }
}
