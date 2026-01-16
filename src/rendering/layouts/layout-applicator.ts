import { dirname, join } from "@veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, ProviderItem } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import type { LayoutComponentCache } from "./utils/component-loader.ts";
import { applyLayoutsESM, applyLayoutsFunctionBody } from "./utils/applicator.ts";
import { resolveAppComponentPath } from "./utils/app-resolver.ts";
import {
  collectAncestorDirs,
  createErrorBoundary,
  tryLoadReservedInDirs,
} from "../app-reserved.ts";
import { detectAppRouter } from "../router-detection.ts";
import { getProjectReact } from "@veryfront/react";
// Import using bare specifiers that match user code imports
// This ensures SSR and client use the same module instance (same React context)
import { RouterProvider } from "veryfront/router";
import { PageContextProvider } from "veryfront/context";

export interface LayoutApplicationOptions {
  projectDir: string;
  projectId?: string;
  /** Project slug for HTTP fallback in multi-project mode */
  projectSlug?: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  layoutCache: LayoutComponentCache;
  mergedComponents: MDXComponents;
  mode: "development" | "production";
  moduleServerUrl?: string;
  /** Request URL for SSR - provides domain for useRouter() */
  requestUrl?: URL;
  /** Merged frontmatter from pageBundle and entity for PageContextProvider */
  frontmatter?: Record<string, unknown>;
  /** Headings extracted from MDX content for table of contents/sidebar navigation */
  headings?: Array<{ id: string; text: string; level: number }>;
}

export class LayoutApplicator {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private layoutCache: LayoutComponentCache;
  private mergedComponents: MDXComponents;
  private mode: "development" | "production";
  private moduleServerUrl?: string;
  private requestUrl?: URL;
  private frontmatter?: Record<string, unknown>;
  private headings?: Array<{ id: string; text: string; level: number }>;
  private projectId?: string;
  private projectSlug?: string;

  constructor(options: LayoutApplicationOptions) {
    this.projectDir = options.projectDir;
    this.projectId = options.projectId;
    this.projectSlug = options.projectSlug;
    this.adapter = options.adapter;
    this.config = options.config;
    this.layoutCache = options.layoutCache;
    this.mergedComponents = options.mergedComponents;
    this.mode = options.mode;
    this.moduleServerUrl = options.moduleServerUrl;
    this.requestUrl = options.requestUrl;
    this.frontmatter = options.frontmatter;
    this.headings = options.headings;
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
    const pageFilePath = pageInfo.entity.path;

    // Check if App was already applied as a provider to avoid double-wrapping
    // which causes duplicate <Head> content and hydration errors
    const isAppPath = (path: string | undefined): boolean =>
      !!path && (/\/components\/app\.[jt]sx?$/.test(path) || /\/app\.[jt]sx?$/.test(path));
    const hasAppProvider = providerItems.some((p) => isAppPath(p.componentPath));

    // Skip App component wrapping for dot-prefixed paths (e.g., .veryfront) - these are
    // framework-level pages that should not use user-defined App component
    const isDotPath = pageFilePath.split("/").some((s) =>
      s.startsWith(".") && s !== "." && s !== ".."
    );

    if (!useAppRouter && !hasAppProvider && !isDotPath) {
      wrappedElement = await this.wrapWithAppComponent(wrappedElement);
    } else if (hasAppProvider) {
      logger.debug("Skipping wrapWithAppComponent - App already applied as provider");
    } else if (isDotPath) {
      logger.debug("Skipping wrapWithAppComponent - dot-prefixed path");
    }

    if (useAppRouter) {
      wrappedElement = await this.wrapWithReservedComponents(wrappedElement, pageFilePath);
    }

    // Wrap with RouterProvider to match client-side tree structure
    // This ensures useId() generates consistent IDs between SSR and client
    const React = await getProjectReact();

    // Build page context with frontmatter for usePageContext() hook
    // Use merged frontmatter (from MDX compilation + entity) when available
    const headingsArray = this.headings || [];
    const pageContext = {
      slug: pageInfo.entity.slug || "",
      path: pageFilePath,
      params: {},
      query: {},
      frontmatter: this.frontmatter || pageInfo.entity.frontmatter || {},
      headings: headingsArray,
      mdxHeadings: headingsArray, // Alias for backwards compatibility
    };
    logger.debug("[LayoutApplicator] PageContext", {
      frontmatterKeys: Object.keys(pageContext.frontmatter),
      headingsCount: headingsArray.length,
    });

    // Wrap with PageContextProvider so layout components can access frontmatter via usePageContext()
    wrappedElement = React.createElement(
      PageContextProvider,
      { pageContext, children: wrappedElement },
    ) as BundledReact.ReactElement;
    logger.debug("Wrapped element with PageContextProvider for frontmatter access");

    // Build router value with domain from request URL for SSR
    const ssrRouter = {
      domain: this.requestUrl ? this.requestUrl.origin : "",
      path: this.requestUrl?.pathname || pageFilePath,
      pathname: this.requestUrl?.pathname || `/${pageInfo.entity.slug || ""}`,
      params: {},
      query: this.requestUrl ? Object.fromEntries(this.requestUrl.searchParams) : {},
      isPreview: false,
      isMounted: false,
      navigate: async () => {},
      push: async () => {},
      replace: async () => {},
      reload: async () => {},
    };

    wrappedElement = React.createElement(
      RouterProvider,
      { router: ssrRouter, children: wrappedElement },
    ) as BundledReact.ReactElement;
    logger.debug("Wrapped element with RouterProvider for SSR");

    return wrappedElement;
  }

  private async applyLayoutsAndProviders(
    pageElement: BundledReact.ReactElement,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerItems: ProviderItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    logger.debug("Applying layouts", {
      nestedLayoutCount: nestedLayouts.length,
      hasLayoutBundle: !!layoutBundle,
    });
    const useESMWrap = Boolean(this.config?.experimental?.esmLayouts);

    if (useESMWrap) {
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
        this.projectId,
        this.projectSlug,
      );
    }

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
      this.projectId,
      this.projectSlug,
    );
  }

  private async wrapWithAppComponent(
    pageElement: BundledReact.ReactElement,
  ): Promise<BundledReact.ReactElement> {
    const appPath = await resolveAppComponentPath(this.projectDir, this.adapter, this.config);
    if (!appPath) return pageElement;

    try {
      logger.info("Loading App component from", appPath);
      const appSource = await this.adapter.fs.readFile(appPath);
      const isMdx = appPath.endsWith(".mdx") || appPath.endsWith(".md");

      let App: React.ComponentType<Record<string, unknown>> | null = null;

      if (isMdx) {
        // Handle MDX files - compile and load
        App = await this.loadMdxAppComponent(appSource, appPath);
      } else {
        // Handle regular TSX/JSX files
        const { loadComponentFromSource } = await import(
          "@veryfront/modules/react-loader/index.ts"
        );
        App = await loadComponentFromSource(
          appSource,
          appPath,
          this.projectDir,
          this.adapter,
          {
            projectId: this.projectId ?? this.projectDir,
            dev: this.mode === "development",
            moduleServerUrl: this.config?.dev?.moduleServerUrl,
          },
        );
      }

      if (App) {
        const React = await getProjectReact();
        logger.info("Wrapped page with App component");
        return React.createElement(App, { children: pageElement }) as BundledReact.ReactElement;
      }
    } catch (error) {
      logger.warn("Failed to load App component:", error);
    }

    return pageElement;
  }

  private async loadMdxAppComponent(
    source: string,
    appPath: string,
  ): Promise<React.ComponentType<Record<string, unknown>> | null> {
    try {
      const { compile } = await import("@mdx-js/mdx");
      const { extract } = await import("std/front_matter/yaml.ts");
      const { getRehypePlugins, getRemarkPlugins } = await import(
        "@veryfront/transforms/plugins/plugin-loader.ts"
      );

      // Extract frontmatter
      let body = source;
      if (source.trim().startsWith("---")) {
        const extracted = extract(source);
        body = extracted.body;
      }

      const remarkPlugins = await getRemarkPlugins();
      const rehypePlugins = await getRehypePlugins();

      // Compile MDX to JavaScript
      const compiled = await compile(body, {
        jsx: true,
        jsxRuntime: "automatic",
        jsxImportSource: "react",
        development: this.mode === "development",
        remarkPlugins,
        rehypePlugins,
      });

      const jsCode = String(compiled);

      // Load the compiled module
      const { loadComponentFromSource } = await import(
        "@veryfront/modules/react-loader/index.ts"
      );

      return await loadComponentFromSource(
        jsCode,
        appPath.replace(/\.mdx?$/, ".jsx"),
        this.projectDir,
        this.adapter,
        {
          projectId: this.projectId ?? this.projectDir,
          dev: this.mode === "development",
          moduleServerUrl: this.config?.dev?.moduleServerUrl,
        },
      );
    } catch (error) {
      logger.error("[LayoutApplicator] Failed to compile MDX app component:", error);
      return null;
    }
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
        this.projectId,
      );

      const errorComp = await tryLoadReservedInDirs(
        searchDirs,
        "error",
        this.projectDir,
        this.mode,
        this.adapter,
        this.projectId,
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
