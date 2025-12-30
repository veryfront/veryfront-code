import { dirname, join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import type { LayoutComponentCache } from "./utils/component-loader.ts";
import { applyLayoutsESM, applyLayoutsFunctionBody } from "./utils/applicator.ts";
import {
  collectAncestorDirs,
  createErrorBoundary,
  tryLoadReservedInDirs,
} from "../app-reserved.ts";
import { detectAppRouter } from "../router-detection.ts";
import { getProjectReact } from "@veryfront/react";

export interface LayoutApplicationOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  layoutCache: LayoutComponentCache;
  mergedComponents: MDXComponents;
  mode: "development" | "production";
  moduleServerUrl?: string;
}

export class LayoutApplicator {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private layoutCache: LayoutComponentCache;
  private mergedComponents: MDXComponents;
  private mode: "development" | "production";
  private moduleServerUrl?: string;

  constructor(options: LayoutApplicationOptions) {
    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.config = options.config;
    this.layoutCache = options.layoutCache;
    this.mergedComponents = options.mergedComponents;
    this.mode = options.mode;
    this.moduleServerUrl = options.moduleServerUrl;
  }

  async applyLayouts(
    pageElement: BundledReact.ReactElement,
    pageInfo: EntityInfo,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    let wrappedElement = await this.applyLayoutsAndProviders(
      pageElement,
      layoutBundle,
      nestedLayouts,
      providerItems,
      layoutDataMap,
    );

    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);
    const pageFilePath = pageInfo.entity.id;

    if (!useAppRouter) {
      wrappedElement = await this.wrapWithAppComponent(wrappedElement);
    } else {
      wrappedElement = await this.wrapWithReservedComponents(wrappedElement, pageFilePath);
    }

    return wrappedElement;
  }

  private async applyLayoutsAndProviders(
    pageElement: BundledReact.ReactElement,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    logger.info("Number of nested layouts found:", nestedLayouts.length);
    logger.info("Has layoutBundle (named layout from frontmatter):", !!layoutBundle);
    if (layoutBundle) {
      logger.info("layoutBundle compiledCode length:", layoutBundle.compiledCode?.length);
    }
    const useESMWrap = Boolean(this.config?.experimental?.esmLayouts);

    if (useESMWrap) {
      return await this.applyLayoutsESMMode(
        pageElement,
        layoutBundle,
        nestedLayouts,
        providerItems,
        layoutDataMap,
      );
    } else {
      return await this.applyLayoutsFunctionBodyMode(
        pageElement,
        layoutBundle,
        nestedLayouts,
        providerItems,
        layoutDataMap,
      );
    }
  }

  private async applyLayoutsESMMode(
    pageElement: BundledReact.ReactElement,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    return await applyLayoutsESM(
      pageElement,
      layoutBundle,
      nestedLayouts,
      providerItems,
      this.projectDir,
      this.mergedComponents,
      this.layoutCache,
      this.adapter,
      layoutDataMap,
    );
  }

  private async applyLayoutsFunctionBodyMode(
    pageElement: BundledReact.ReactElement,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    return await applyLayoutsFunctionBody(
      pageElement,
      layoutBundle,
      nestedLayouts,
      providerItems,
      this.mergedComponents,
      this.layoutCache,
      this.projectDir,
      this.adapter,
      layoutDataMap,
    );
  }

  private isValidComponentPath(path: string): boolean {
    return /\.(tsx|jsx|ts|js)$/.test(path);
  }

  private async resolveAppComponentPath(): Promise<string | null> {
    // Priority 1: Check config.app from veryfront.config.ts
    const configApp = this.config?.app;
    if (configApp && this.isValidComponentPath(configApp)) {
      const appPath = configApp.startsWith("/") || configApp.startsWith(this.projectDir)
        ? configApp
        : join(this.projectDir, configApp);

      const exists = await this.adapter.fs.exists(appPath);
      if (exists) {
        logger.debug("[LayoutApplicator] Using config.app", { path: appPath });
        return appPath;
      }
      logger.debug("[LayoutApplicator] config.app path not found", { configApp, appPath });
    }

    // Priority 2: Check API project data (for Veryfront Studio)
    const wrappedAdapter = (this.adapter?.fs as { fsAdapter?: unknown })?.fsAdapter;
    const isVeryfrontAPI =
      (wrappedAdapter as { constructor?: { name?: string } })?.constructor?.name === "VeryfrontFSAdapter";

    if (isVeryfrontAPI) {
      const projectData = (wrappedAdapter as {
        getProjectData: () => { app?: string } | undefined;
      }).getProjectData?.();

      if (projectData?.app && this.isValidComponentPath(projectData.app)) {
        const appPath = join(this.projectDir, "components", projectData.app);
        const exists = await (wrappedAdapter as { exists: (path: string) => Promise<boolean> }).exists(appPath);

        if (exists) {
          logger.debug("[LayoutApplicator] Using API project app", { path: appPath });
          return appPath;
        }
      }
    }

    // Priority 3: Default discovery - check components/app.tsx
    const defaultAppPath = join(this.projectDir, "components/app.tsx");
    const defaultExists = await this.adapter.fs.exists(defaultAppPath);
    if (defaultExists) {
      return defaultAppPath;
    }

    // Try other extensions
    const extensions = ["jsx", "ts", "js"];
    for (const ext of extensions) {
      const altPath = join(this.projectDir, `components/app.${ext}`);
      const exists = await this.adapter.fs.exists(altPath);
      if (exists) {
        return altPath;
      }
    }

    return null;
  }

  private async wrapWithAppComponent(
    pageElement: BundledReact.ReactElement,
  ): Promise<BundledReact.ReactElement> {
    const React = await getProjectReact();
    try {
      const appPath = await this.resolveAppComponentPath();
      if (!appPath) {
        return pageElement;
      }
      const appExists = await this.adapter.fs.exists(appPath);

      if (appExists) {
        logger.info("Loading App component from", appPath);
        const { loadComponentFromSource } = await import(
          "@veryfront/modules/react-loader/index.ts"
        );
        const appSource = await this.adapter.fs.readFile(appPath);
        const App = await loadComponentFromSource(
          appSource,
          appPath,
          this.projectDir,
          this.adapter,
          {
            projectId: this.projectDir,
            dev: this.mode === "development",
            moduleServerUrl: this.config?.dev?.moduleServerUrl,
          },
        );

        if (App) {
          pageElement = React.createElement(App, {
            children: pageElement,
          }) as BundledReact.ReactElement;
          logger.info("Wrapped page with App component");
        }
      }
    } catch (error) {
      logger.warn("Failed to load App component:", error);
    }

    return pageElement;
  }

  private async wrapWithReservedComponents(
    pageElement: BundledReact.ReactElement,
    pageFilePath: string,
  ): Promise<BundledReact.ReactElement> {
    const React = await getProjectReact();
    try {
      const segmentDir = dirname(pageFilePath);
      const appRootDir = join(this.projectDir, "app");
      const searchDirs = await collectAncestorDirs(segmentDir, appRootDir);

      const loadingComp = await tryLoadReservedInDirs(
        searchDirs,
        "loading",
        this.projectDir,
        this.mode,
        this.adapter,
      );

      const errorComp = await tryLoadReservedInDirs(
        searchDirs,
        "error",
        this.projectDir,
        this.mode,
        this.adapter,
      );

      if (loadingComp) {
        const fallbackEl = React.createElement(loadingComp, {});
        pageElement = React.createElement(
          React.Suspense,
          { fallback: fallbackEl },
          pageElement,
        ) as BundledReact.ReactElement;
      }

      if (errorComp) {
        const Boundary = createErrorBoundary(errorComp, React);
        pageElement = React.createElement(Boundary, {}, pageElement) as BundledReact.ReactElement;
      }
    } catch (error) {
      logger.warn("Failed applying reserved loading/error components", error);
    }

    return pageElement;
  }
}
