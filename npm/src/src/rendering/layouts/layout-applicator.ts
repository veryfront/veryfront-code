import { dirname, join } from "../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../utils/index.js";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle, MDXComponents } from "../../types/index.js";
import type { EntityInfo } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { ImportMapConfig } from "../../modules/import-map/types.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
import type { LayoutComponentCache } from "./utils/component-loader.js";
import { applyLayoutsESM, applyLayoutsFunctionBody } from "./utils/applicator.js";
import { resolveAppComponentPath } from "./utils/app-resolver.js";
import {
  collectAncestorDirs,
  createErrorBoundary,
  tryLoadReservedInDirs,
} from "../app-reserved.js";
import { detectAppRouter } from "../router-detection.js";
import { getProjectReact } from "../../react/index.js";
import { extract } from "../../platform/compat/std/front-matter-yaml.js";
import { RouterProvider } from "../../react/router/index.js";
import { PageContextProvider } from "../../react/context/index.js";

export interface LayoutApplicationOptions {
  projectDir: string;
  projectId: string;
  projectSlug: string;
  contentSourceId: string;
  preloadedImportMap?: ImportMapConfig | null;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  layoutCache: LayoutComponentCache;
  mergedComponents: MDXComponents;
  mode: "development" | "production";
  moduleServerUrl?: string;
  requestUrl?: URL;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ id: string; text: string; level: number }>;
}

export class LayoutApplicator {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private layoutCache: LayoutComponentCache;
  private mergedComponents: MDXComponents;
  private mode: "development" | "production";
  private requestUrl?: URL;
  private frontmatter?: Record<string, unknown>;
  private headings?: Array<{ id: string; text: string; level: number }>;
  private projectId: string;
  private projectSlug: string;
  private contentSourceId: string;
  private preloadedImportMap?: ImportMapConfig | null;

  constructor(options: LayoutApplicationOptions) {
    this.projectDir = options.projectDir;
    this.projectId = options.projectId;
    this.projectSlug = options.projectSlug;
    this.contentSourceId = options.contentSourceId;
    this.preloadedImportMap = options.preloadedImportMap;
    this.adapter = options.adapter;
    this.config = options.config;
    this.layoutCache = options.layoutCache;
    this.mergedComponents = options.mergedComponents;
    this.mode = options.mode;
    this.requestUrl = options.requestUrl;
    this.frontmatter = options.frontmatter;
    this.headings = options.headings;
  }

  async applyLayouts(
    pageElement: BundledReact.ReactElement,
    pageInfo: EntityInfo,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    return await withSpan(
      SpanNames.LAYOUT_APPLY,
      async () => {
        let wrappedElement = await this.applyLayoutsOnly(
          pageElement,
          layoutBundle,
          nestedLayouts,
          layoutDataMap,
        );

        const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);
        const pageFilePath = pageInfo.entity.path;

        const isDotPath = pageFilePath.split("/").some((s) =>
          s.startsWith(".") && s !== "." && s !== ".."
        );

        if (!useAppRouter && !isDotPath) {
          wrappedElement = await this.wrapWithAppComponent(wrappedElement);
        } else if (isDotPath) {
          logger.debug("Skipping wrapWithAppComponent - dot-prefixed path");
        }

        if (useAppRouter) {
          wrappedElement = await this.wrapWithReservedComponents(wrappedElement, pageFilePath);
        }

        const React = await getProjectReact();

        const headingsArray = this.headings ?? [];
        const pageContext = {
          slug: pageInfo.entity.slug || "",
          path: pageFilePath,
          params: {},
          query: {},
          frontmatter: this.frontmatter ?? pageInfo.entity.frontmatter ?? {},
          headings: headingsArray,
          mdxHeadings: headingsArray,
        };

        logger.debug("[LayoutApplicator] PageContext", {
          frontmatterKeys: Object.keys(pageContext.frontmatter),
          headingsCount: headingsArray.length,
        });

        wrappedElement = React.createElement(PageContextProvider, {
          pageContext,
          children: wrappedElement,
        }) as BundledReact.ReactElement;

        logger.debug("Wrapped element with PageContextProvider for frontmatter access");

        const ssrRouter = {
          domain: this.requestUrl?.origin ?? "",
          path: this.requestUrl?.pathname ?? pageFilePath,
          pathname: this.requestUrl?.pathname ?? `/${pageInfo.entity.slug || ""}`,
          params: {},
          query: this.requestUrl ? Object.fromEntries(this.requestUrl.searchParams) : {},
          isPreview: false,
          isMounted: false,
          navigate: async () => {},
          push: async () => {},
          replace: async () => {},
          reload: async () => {},
        };

        wrappedElement = React.createElement(RouterProvider, {
          router: ssrRouter,
          children: wrappedElement,
        }) as BundledReact.ReactElement;

        logger.debug("Wrapped element with RouterProvider for SSR");

        return wrappedElement;
      },
      {
        "layout.page_path": pageInfo.entity.path,
        "layout.nested_count": nestedLayouts.length,
        "layout.has_bundle": !!layoutBundle,
        "layout.project_dir": this.projectDir,
      },
    );
  }

  private async applyLayoutsOnly(
    pageElement: BundledReact.ReactElement,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
  ): Promise<BundledReact.ReactElement> {
    return await withSpan(
      SpanNames.LAYOUT_APPLY_ONLY,
      async () => {
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
            this.projectDir,
            this.mergedComponents,
            this.layoutCache,
            this.adapter,
            layoutDataMap,
            this.projectId,
            this.projectSlug,
            this.contentSourceId,
            this.preloadedImportMap ?? undefined,
          );
        }

        return await applyLayoutsFunctionBody(
          pageElement,
          layoutBundle,
          nestedLayouts,
          this.mergedComponents,
          this.layoutCache,
          this.projectDir,
          this.adapter,
          layoutDataMap,
          this.projectId,
          this.projectSlug,
          this.contentSourceId,
        );
      },
      {
        "layout.nested_count": nestedLayouts.length,
        "layout.has_bundle": !!layoutBundle,
        "layout.use_esm": Boolean(this.config?.experimental?.esmLayouts),
      },
    );
  }

  private async wrapWithAppComponent(
    pageElement: BundledReact.ReactElement,
  ): Promise<BundledReact.ReactElement> {
    return await withSpan(
      SpanNames.LAYOUT_WRAP_APP_COMPONENT,
      async () => {
        const appPath = await resolveAppComponentPath(this.projectDir, this.adapter, this.config);
        if (!appPath) return pageElement;

        try {
          logger.debug("Loading App component from", appPath);
          const appSource = await this.adapter.fs.readFile(appPath);
          const isMdx = appPath.endsWith(".mdx") || appPath.endsWith(".md");

          // deno-lint-ignore no-explicit-any
          let App: any;

          if (isMdx) {
            App = await this.loadMdxAppComponent(appSource, appPath);
          } else {
            const { loadComponentFromSource } = await import(
              "../../modules/react-loader/index.js"
            );
            App = await loadComponentFromSource(
              appSource,
              appPath,
              this.projectDir,
              this.adapter,
              {
                projectId: this.projectId ?? this.projectDir,
                projectSlug: this.projectSlug,
                dev: this.mode === "development",
                moduleServerUrl: this.config?.dev?.moduleServerUrl,
                contentSourceId: this.contentSourceId,
              },
            );
          }

          if (!App) {
            return pageElement;
          }

          const React = await getProjectReact();
          logger.debug("Wrapped page with App component");
          return React.createElement(App, { children: pageElement }) as BundledReact.ReactElement;
        } catch (error) {
          logger.warn("Failed to load App component:", error);
          return pageElement;
        }
      },
      {
        "layout.project_dir": this.projectDir,
      },
    );
  }

  // deno-lint-ignore no-explicit-any
  private async loadMdxAppComponent(source: string, appPath: string): Promise<any> {
    try {
      const { compile } = await import("@mdx-js/mdx");
      const { getRehypePlugins, getRemarkPlugins } = await import(
        "../../transforms/plugins/plugin-loader.js"
      );

      let body = source;
      if (source.trim().startsWith("---")) {
        body = extract(source).body;
      }

      const [remarkPlugins, rehypePlugins] = await Promise.all([
        getRemarkPlugins(),
        getRehypePlugins(),
      ]);

      const compiled = await compile(body, {
        jsx: true,
        jsxRuntime: "automatic",
        jsxImportSource: "react",
        development: this.mode === "development",
        remarkPlugins,
        rehypePlugins,
      });

      const { loadComponentFromSource } = await import(
        "../../modules/react-loader/index.js"
      );

      return await loadComponentFromSource(
        String(compiled),
        appPath.replace(/\.mdx?$/, ".jsx"),
        this.projectDir,
        this.adapter,
        {
          projectId: this.projectId ?? this.projectDir,
          projectSlug: this.projectSlug,
          dev: this.mode === "development",
          moduleServerUrl: this.config?.dev?.moduleServerUrl,
          contentSourceId: this.contentSourceId,
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
    return await withSpan(
      SpanNames.LAYOUT_WRAP_RESERVED,
      async () => {
        const React = await getProjectReact();

        try {
          const segmentDir = dirname(pageFilePath);
          const appRootDir = join(this.projectDir, "app");
          const searchDirs = await collectAncestorDirs(segmentDir, appRootDir);

          const [loadingComp, errorComp] = await Promise.all([
            tryLoadReservedInDirs(
              searchDirs,
              "loading",
              this.projectDir,
              this.mode,
              this.adapter,
              this.projectId,
              this.contentSourceId,
            ),
            tryLoadReservedInDirs(
              searchDirs,
              "error",
              this.projectDir,
              this.mode,
              this.adapter,
              this.projectId,
              this.contentSourceId,
            ),
          ]);

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
            pageElement = React.createElement(
              Boundary,
              {},
              pageElement,
            ) as BundledReact.ReactElement;
          }
        } catch (error) {
          logger.warn("Failed applying reserved loading/error components", error);
        }

        return pageElement;
      },
      {
        "layout.page_path": pageFilePath,
        "layout.project_dir": this.projectDir,
      },
    );
  }
}
