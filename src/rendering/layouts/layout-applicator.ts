import { dirname, join } from "#veryfront/compat/path";
import { rendererLogger, throwIfAborted } from "#veryfront/utils";
import { flattenRouteParams } from "#veryfront/routing";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { EntityInfo } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import type { LayoutComponentCache } from "./utils/component-loader.ts";
import { applyLayoutsESM } from "./utils/applicator.ts";
import { resolveAppComponentPath } from "./utils/app-resolver.ts";
import {
  collectAncestorDirs,
  createErrorBoundary,
  tryLoadReservedInDirs,
} from "../app-reserved.ts";
import { resolveRouterModeForPage } from "../router-detection.ts";
import { getProjectReact } from "#veryfront/react";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { extractComponent } from "#veryfront/modules/react-loader/extract-component.ts";
import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { resolveFrameworkSourcePath } from "#veryfront/platform/compat/framework-source-resolver.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import type { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import {
  type DependencyPinningSourceInput,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { CLIENT_PAGE_ISLAND_ID } from "#veryfront/rendering/rsc/page-island.ts";
import { isDotPath } from "../orchestrator/path-helpers.ts";
import type {
  RenderEnvironment,
  RenderModes,
} from "#veryfront/rendering/context/render-context.ts";

const logger = rendererLogger.component("layout-applicator");

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
  /** Compile vocabulary. Selects minification and tree shaking. */
  mode: "development" | "production";
  /**
   * Request vocabulary. Selects preview-only instrumentation. A hosted preview
   * render is mode "production" with environment "preview".
   */
  environment: RenderEnvironment;
  moduleServerUrl?: string;
  requestUrl?: URL;
  params?: Record<string, string | string[]>;
  frontmatter?: Record<string, unknown>;
  /** Props from the page's `getServerData`, exposed on the page context as `data`. */
  pageProps?: Record<string, unknown>;
  headings?: Array<{ id: string; text: string; level: number }>;
  reactVersion?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Server-trusted local-project identity. */
  isLocalProject?: boolean;
  /** Cooperative cancellation for request-scoped SSR module loads. */
  signal?: AbortSignal;
}

interface LayoutApplicatorDependencies {
  loadComponentFromSource?: typeof loadComponentFromSource;
}

export class LayoutApplicator {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private layoutCache: LayoutComponentCache;
  private mergedComponents: MDXComponents;
  private mode: "development" | "production";
  private environment: RenderEnvironment;
  private requestUrl?: URL;
  private params?: Record<string, string | string[]>;
  private frontmatter?: Record<string, unknown>;
  private pageProps?: Record<string, unknown>;
  private headings?: Array<{ id: string; text: string; level: number }>;
  private projectId: string;
  private projectSlug: string;
  private contentSourceId: string;
  private preloadedImportMap?: ImportMapConfig | null;
  private readonly configuredReactVersion?: string;
  private readonly dependencyPinningCacheKey?: string;
  private readonly dependencyPinningDependencies?: Readonly<Record<string, string>>;
  private readonly dependencyPinningSource?: DependencyPinningSourceInput;
  private readonly isLocalProject: boolean;
  private readonly signal?: AbortSignal;
  private readonly componentSourceLoader?: typeof loadComponentFromSource;
  private reactVersionPromise: Promise<string> | null = null;
  private frameworkProviderModulesPromise?: Promise<{
    PageContextProvider: BundledReact.ComponentType<Record<string, unknown>>;
    RouterProvider: BundledReact.ComponentType<Record<string, unknown>>;
  }>;

  constructor(
    options: LayoutApplicationOptions,
    dependencies: LayoutApplicatorDependencies = {},
  ) {
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
    this.environment = options.environment;
    this.requestUrl = options.requestUrl;
    this.params = options.params;
    this.frontmatter = options.frontmatter;
    this.pageProps = options.pageProps;
    this.headings = options.headings;
    this.configuredReactVersion = options.reactVersion;
    this.dependencyPinningCacheKey = options.dependencyPinningCacheKey;
    this.dependencyPinningDependencies = options.dependencyPinningDependencies;
    this.dependencyPinningSource = options.dependencyPinningSource;
    this.isLocalProject = options.isLocalProject === true;
    this.signal = options.signal;
    this.componentSourceLoader = dependencies.loadComponentFromSource;
  }

  private async getComponentSourceLoader(): Promise<typeof loadComponentFromSource> {
    return this.componentSourceLoader ??
      (await import("#veryfront/modules/react-loader/index.ts")).loadComponentFromSource;
  }

  private get renderModes(): RenderModes {
    return { compileMode: this.mode, environment: this.environment };
  }

  private getReactVersion(): Promise<string> {
    this.reactVersionPromise ??= this.configuredReactVersion
      ? Promise.resolve(this.configuredReactVersion)
      : resolveProjectReactVersion({
        projectDir: this.projectDir,
        config: this.config,
        dependencyPinningCacheKey: this.dependencyPinningCacheKey,
        dependencyPinningDependencies: this.dependencyPinningDependencies,
      });
    return this.reactVersionPromise;
  }

  async applyLayouts(
    pageElement: BundledReact.ReactElement,
    pageInfo: EntityInfo,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
    clientPageIsland?: { clientLayoutPaths: readonly string[] },
  ): Promise<BundledReact.ReactElement> {
    return await withSpan(
      SpanNames.LAYOUT_APPLY,
      async () => {
        const reactVersion = await this.getReactVersion();
        let wrappedElement: BundledReact.ReactElement;
        if (clientPageIsland) {
          const clientPaths = new Set(clientPageIsland.clientLayoutPaths);
          const clientLayouts = nestedLayouts.filter((layout) =>
            clientPaths.has(layout.componentPath ?? layout.path ?? "")
          );
          const serverLayouts = nestedLayouts.filter((layout) =>
            !clientPaths.has(layout.componentPath ?? layout.path ?? "")
          );
          const clientTree = await this.applyLayoutsOnly(
            pageElement,
            undefined,
            clientLayouts,
            layoutDataMap,
            reactVersion,
          );
          const React = await getProjectReact(reactVersion, this.adapter);
          const island = React.createElement(
            "div",
            { id: CLIENT_PAGE_ISLAND_ID },
            clientTree,
          ) as BundledReact.ReactElement;
          wrappedElement = await this.applyLayoutsOnly(
            island,
            layoutBundle,
            serverLayouts,
            layoutDataMap,
            reactVersion,
          );
        } else {
          wrappedElement = await this.applyLayoutsOnly(
            pageElement,
            layoutBundle,
            nestedLayouts,
            layoutDataMap,
            reactVersion,
          );
        }

        const pageFilePath = pageInfo.entity.path;
        const routerMode = resolveRouterModeForPage(
          this.projectDir,
          pageFilePath,
          this.config,
        );

        const dotPath = isDotPath({
          slug: pageInfo.entity.slug ?? "",
          filePath: pageFilePath,
          projectDir: this.projectDir,
        });

        if (routerMode === "app") {
          wrappedElement = await this.wrapWithReservedComponents(wrappedElement, pageFilePath);
        } else if (dotPath) {
          logger.debug("Skipping wrapWithAppComponent - dot-prefixed path");
        } else {
          wrappedElement = await this.wrapWithAppComponent(wrappedElement);
        }

        const React = await getProjectReact(reactVersion, this.adapter);

        const headingsArray = this.headings ?? [];
        const flatParams = flattenRouteParams(this.params);
        const query = this.requestUrl ? Object.fromEntries(this.requestUrl.searchParams) : {};
        const pageContext = {
          slug: pageInfo.entity.slug || "",
          path: pageFilePath,
          params: flatParams,
          query,
          frontmatter: this.frontmatter ?? pageInfo.entity.frontmatter ?? {},
          data: this.pageProps ?? {},
          headings: headingsArray,
          mdxHeadings: headingsArray,
        };

        logger.debug("PageContext", {
          frontmatterKeys: Object.keys(pageContext.frontmatter),
          headingsCount: headingsArray.length,
        });

        const { PageContextProvider, RouterProvider } = await this.loadFrameworkProviders();

        wrappedElement = React.createElement(PageContextProvider, {
          pageContext,
          children: wrappedElement,
        }) as BundledReact.ReactElement;

        logger.debug("Wrapped element with PageContextProvider for frontmatter access");

        const ssrRouter = {
          domain: this.requestUrl?.origin ?? "",
          path: this.requestUrl?.pathname ?? pageFilePath,
          pathname: this.requestUrl?.pathname ?? `/${pageInfo.entity.slug || ""}`,
          params: flatParams,
          query,
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
    reactVersion?: string,
  ): Promise<BundledReact.ReactElement> {
    return await withSpan(
      SpanNames.LAYOUT_APPLY_ONLY,
      async () => {
        logger.debug("Applying layouts", {
          nestedLayoutCount: nestedLayouts.length,
          hasLayoutBundle: !!layoutBundle,
        });

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
          this.renderModes,
          this.preloadedImportMap ?? undefined,
          reactVersion,
          this.dependencyPinningCacheKey,
          this.dependencyPinningDependencies,
          this.dependencyPinningSource,
          this.requestUrl?.origin,
          this.config,
          this.isLocalProject,
          this.signal,
        );
      },
      {
        "layout.nested_count": nestedLayouts.length,
        "layout.has_bundle": !!layoutBundle,
        "layout.use_esm": true,
      },
    );
  }

  private async loadFrameworkProviders(): Promise<{
    PageContextProvider: BundledReact.ComponentType<Record<string, unknown>>;
    RouterProvider: BundledReact.ComponentType<Record<string, unknown>>;
  }> {
    if (!this.frameworkProviderModulesPromise) {
      this.frameworkProviderModulesPromise = this.loadFrameworkProvidersInternal();
    }

    return await this.frameworkProviderModulesPromise;
  }

  private async loadFrameworkProvidersInternal(): Promise<{
    PageContextProvider: BundledReact.ComponentType<Record<string, unknown>>;
    RouterProvider: BundledReact.ComponentType<Record<string, unknown>>;
  }> {
    const prepared = getRuntimeModuleLoader(this.adapter);
    const [contextModule, routerModule] = prepared
      ? await Promise.all([
        prepared.importModule({ kind: "package", specifier: "veryfront/context" }),
        prepared.importModule({ kind: "package", specifier: "veryfront/router" }),
      ])
      : await this.loadLegacyFrameworkProviders();
    const PageContextProvider = contextModule.PageContextProvider;
    const RouterProvider = routerModule.RouterProvider;
    if (typeof PageContextProvider !== "function" || typeof RouterProvider !== "function") {
      throw new Error("Failed to load framework context or router providers");
    }
    return {
      PageContextProvider: PageContextProvider as BundledReact.ComponentType<
        Record<string, unknown>
      >,
      RouterProvider: RouterProvider as BundledReact.ComponentType<Record<string, unknown>>,
    };
  }

  private async loadLegacyFrameworkProviders(): Promise<
    [Record<string, unknown>, Record<string, unknown>]
  > {
    const fs = createFileSystem();
    const decoder = new TextDecoder();
    const [contextModuleInfo, routerModuleInfo] = await Promise.all([
      resolveFrameworkSourcePath("react/context"),
      resolveFrameworkSourcePath("react/router"),
    ]);

    if (!contextModuleInfo?.path || !routerModuleInfo?.path) {
      throw new Error("Failed to resolve framework context or router source modules");
    }

    const [contextSource, routerSource] = await Promise.all([
      fs.readFile(contextModuleInfo.path),
      fs.readFile(routerModuleInfo.path),
    ]);

    const loadOptions = {
      projectId: this.projectId,
      projectSlug: this.projectSlug,
      contentSourceId: this.contentSourceId,
      dev: this.mode === "development",
      mode: this.environment,
      reactVersion: await this.getReactVersion(),
      dependencyPinningCacheKey: this.dependencyPinningCacheKey,
      dependencyPinningDependencies: this.dependencyPinningDependencies,
      dependencyPinningSource: this.dependencyPinningSource,
      moduleServerOrigin: this.requestUrl?.origin,
      signal: this.signal,
    } as const;

    return await Promise.all([
      loadModuleFromSource(
        decoder.decode(contextSource),
        contextModuleInfo.path,
        this.projectDir,
        this.adapter,
        loadOptions,
      ),
      loadModuleFromSource(
        decoder.decode(routerSource),
        routerModuleInfo.path,
        this.projectDir,
        this.adapter,
        loadOptions,
      ),
    ]);
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

          let App: BundledReact.ComponentType<Record<string, unknown>> | null;

          if (isMdx) {
            App = await this.loadMdxAppComponent(appSource, appPath);
          } else {
            const loadComponentFromSource = await this.getComponentSourceLoader();
            App = await loadComponentFromSource(
              appSource,
              appPath,
              this.projectDir,
              this.adapter,
              {
                projectId: this.projectId ?? this.projectDir,
                projectSlug: this.projectSlug,
                dev: this.mode === "development",
                mode: this.environment,
                moduleServerUrl: this.config?.dev?.moduleServerUrl,
                moduleServerOrigin: this.requestUrl?.origin,
                contentSourceId: this.contentSourceId,
                reactVersion: await this.getReactVersion(),
                dependencyPinningCacheKey: this.dependencyPinningCacheKey,
                dependencyPinningDependencies: this.dependencyPinningDependencies,
                dependencyPinningSource: this.dependencyPinningSource,
                serverExternalPackages: this.config?.build?.serverExternalPackages,
                signal: this.signal,
              },
            );
          }

          if (!App) return pageElement;

          const React = await getProjectReact(await this.getReactVersion(), this.adapter);
          logger.debug("Wrapped page with App component");
          return React.createElement(App, { children: pageElement }) as BundledReact.ReactElement;
        } catch (error) {
          throwIfAborted(this.signal);
          logger.warn("Failed to load App component:", error);
          return pageElement;
        }
      },
      {
        "layout.project_dir": this.projectDir,
      },
    );
  }

  private async loadMdxAppComponent(
    source: string,
    appPath: string,
  ): Promise<BundledReact.ComponentType<Record<string, unknown>> | null> {
    const prepared = getRuntimeModuleLoader(this.adapter);
    if (prepared) {
      const module = await prepared.importModule({ kind: "source", path: appPath });
      throwIfAborted(this.signal);
      return extractComponent(module, appPath);
    }
    try {
      const body = source.trim().startsWith("---") ? extract(source).body : source;

      const processor = resolveContract<ContentProcessor>("ContentProcessor");
      const compiled = await processor.compileMdx({
        projectDir: this.projectDir,
        content: body,
        filePath: appPath,
        mode: this.mode,
        target: "server",
      });

      const loadComponentFromSource = await this.getComponentSourceLoader();

      return await loadComponentFromSource(
        compiled.compiledCode,
        appPath.replace(/\.mdx?$/, ".jsx"),
        this.projectDir,
        this.adapter,
        {
          projectId: this.projectId ?? this.projectDir,
          projectSlug: this.projectSlug,
          dev: this.mode === "development",
          mode: this.environment,
          moduleServerUrl: this.config?.dev?.moduleServerUrl,
          moduleServerOrigin: this.requestUrl?.origin,
          contentSourceId: this.contentSourceId,
          reactVersion: await this.getReactVersion(),
          dependencyPinningCacheKey: this.dependencyPinningCacheKey,
          dependencyPinningDependencies: this.dependencyPinningDependencies,
          dependencyPinningSource: this.dependencyPinningSource,
          serverExternalPackages: this.config?.build?.serverExternalPackages,
          signal: this.signal,
        },
      );
    } catch (error) {
      throwIfAborted(this.signal);
      logger.error("Failed to compile MDX app component:", error);
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
        const reactVersion = await this.getReactVersion();
        const React = await getProjectReact(reactVersion, this.adapter);

        try {
          const segmentDir = dirname(pageFilePath);
          const appRootDir = join(
            this.projectDir,
            this.config?.directories?.app ?? "app",
          );
          const searchDirs = await collectAncestorDirs(segmentDir, appRootDir);
          const reservedDeps = { loadComponentFromSource: await this.getComponentSourceLoader() };

          const [loadingComp, errorComp] = await Promise.all([
            tryLoadReservedInDirs(
              searchDirs,
              "loading",
              this.projectDir,
              this.renderModes,
              this.adapter,
              this.projectId,
              this.contentSourceId,
              reactVersion,
              this.dependencyPinningCacheKey,
              this.dependencyPinningDependencies,
              this.dependencyPinningSource,
              this.requestUrl?.origin,
              this.config?.build?.serverExternalPackages,
              this.signal,
              reservedDeps,
            ),
            tryLoadReservedInDirs(
              searchDirs,
              "error",
              this.projectDir,
              this.renderModes,
              this.adapter,
              this.projectId,
              this.contentSourceId,
              reactVersion,
              this.dependencyPinningCacheKey,
              this.dependencyPinningDependencies,
              this.dependencyPinningSource,
              this.requestUrl?.origin,
              this.config?.build?.serverExternalPackages,
              this.signal,
              reservedDeps,
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
          throwIfAborted(this.signal);
          throw error;
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
