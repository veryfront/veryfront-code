import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { RENDER_ERROR } from "#veryfront/errors";
import { createDefaultMDXComponents } from "./utils/index.ts";
import { extractRouteParams } from "#veryfront/utils/route-path-utils.ts";
import type { ComponentProps, EntityInfo, MDXComponents, PageBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { handleComponentPage } from "./component-handling.ts";
import { handleMDXPage } from "./page-rendering.ts";
import { handleScriptPage } from "./script-page-handling.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { ComponentRegistry } from "./ssr/component-registry.ts";
import type { RenderResult } from "./orchestrator/types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { RenderEnvironment } from "#veryfront/rendering/context/render-context.ts";

interface PageRenderOptions {
  params?: Record<string, string | string[]>;
  url?: URL;
  props?: ComponentProps;
  nonce?: string;
  /** Project ID for multi-project SSR module isolation */
  projectId?: string;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
  /** Project slug for HTTP fallback in multi-project mode */
  projectSlug?: string;
  /** Content source identifier for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  /** Release that owns the immutable browser artifacts for this render. */
  releaseId?: string;
  /** Request-scoped dependency-pinning state used by transform caches. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace paired with the immutable snapshot. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Internal signal for the render owner's total deadline. */
  abortSignal?: AbortSignal;
  /**
   * Request environment for this render. Takes precedence over the renderer's
   * own, so a renderer instance reused across environments never carries one
   * render's instrumentation into the next.
   */
  environment?: RenderEnvironment;
}

interface PageBundleResult {
  pageElement?: React.ReactElement;
  pageBundle?: PageBundle;
  clientModuleCode?: string;
  pageModuleType?: "mdx" | "component";
  collectedMetadata: Record<string, unknown>;
  scriptResult?: RenderResult;
}

export class PageRenderer {
  private readonly projectDir: string;
  /** Compile vocabulary: "development" | "production". */
  private readonly mode: string;
  /**
   * Request vocabulary: "preview" | "production". Drives studio
   * instrumentation. Only the fallback: a per-render environment wins.
   */
  private readonly environment: RenderEnvironment;
  private readonly config: VeryfrontConfig;
  private readonly adapter: RuntimeAdapter;
  private readonly componentRegistry: ComponentRegistry;
  private readonly compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<PageBundle>;
  private readonly moduleServerUrl?: string;
  private readonly isLocalProject: boolean;
  private reactVersionPromise: Promise<string> | null = null;

  constructor(options: {
    projectDir: string;
    /** Compile vocabulary: "development" | "production". */
    mode: string;
    /**
     * Request vocabulary: "preview" | "production". A hosted preview render is
     * mode "production" with environment "preview", so the two are separate.
     */
    environment: RenderEnvironment;
    config: VeryfrontConfig;
    adapter: RuntimeAdapter;
    componentRegistry: ComponentRegistry;
    compileMDX: (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => Promise<PageBundle>;
    moduleServerUrl?: string;
    /** Server-trusted local-project identity. */
    isLocalProject?: boolean;
  }) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.environment = options.environment;
    this.config = options.config;
    this.adapter = options.adapter;
    this.componentRegistry = options.componentRegistry;
    this.compileMDX = options.compileMDX;
    this.moduleServerUrl = options.moduleServerUrl;
    this.isLocalProject = options.isLocalProject === true;
  }

  private async getMergedComponents(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    environment: RenderEnvironment = this.environment,
  ): Promise<MDXComponents> {
    const snapshotKey = await this.componentRegistry.prepareDependencySnapshot(
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
      dependencyPinningSource,
      moduleServerOrigin,
      this.config.build?.serverExternalPackages,
      environment,
    );
    return {
      ...createDefaultMDXComponents(),
      ...this.componentRegistry.getAllAsComponents(snapshotKey),
    };
  }

  private getReactVersion(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
  ): Promise<string> {
    if (
      dependencyPinningDependencies !== undefined ||
      dependencyPinningCacheKey?.startsWith("on:")
    ) {
      return resolveProjectReactVersion({
        projectDir: this.projectDir,
        config: this.config,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
      });
    }

    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.projectDir,
      config: this.config,
    });
    return this.reactVersionPromise;
  }

  private detectPageType(pageInfo: EntityInfo): {
    type: "mdx" | "component" | "script";
    extension: string;
  } {
    const extension = getExtensionName(pageInfo.entity.path);

    if (extension === "tsx" || extension === "jsx") {
      return { type: "component", extension };
    }

    if (extension === "ts" || extension === "js") {
      return { type: "script", extension };
    }

    return { type: "mdx", extension };
  }

  preparePageBundles(
    pageInfo: EntityInfo,
    slug: string,
    cachedModule: RenderResult["pageModule"] | undefined,
    options?: PageRenderOptions,
  ): Promise<PageBundleResult> {
    const pageType = this.detectPageType(pageInfo);

    return withSpan(
      "render.prepare_page",
      async () => {
        logger.debug(`Page file info:`, {
          path: pageInfo.entity.path,
          extension: pageType.extension,
          type: pageType.type,
          slug,
        });

        if (pageType.type === "script") {
          const scriptResult = await withSpan(
            "render.handle_script",
            () =>
              handleScriptPage(pageInfo, slug, {
                mode: this.mode,
                config: this.config,
                projectDir: this.projectDir,
                adapter: this.adapter,
                params: options?.params,
                url: options?.url,
                props: options?.props,
                nonce: options?.nonce,
                releaseId: options?.releaseId,
                dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
                dependencyPinningDependencies: options?.dependencyPinningDependencies,
              }),
            { "render.script_path": pageInfo.entity.path },
          );

          return { collectedMetadata: {}, scriptResult };
        }

        const reactVersion = await this.getReactVersion(
          options?.dependencyPinningCacheKey,
          options?.dependencyPinningDependencies,
        );

        if (pageType.type === "component") {
          let params = options?.params;
          if (!params || Object.keys(params).length === 0) {
            const extracted = extractRouteParams(
              pageInfo.entity.path,
              slug,
              this.config.directories,
            );
            params = extracted.matched ? extracted.params : undefined;
          }

          const componentProps = {
            ...options?.props,
            ...(params && Object.keys(params).length > 0 ? { params } : {}),
          };

          const result = await withSpan(
            "render.handle_component",
            () =>
              handleComponentPage(
                pageInfo,
                slug,
                this.projectDir,
                this.componentRegistry,
                this.adapter,
                {
                  props: componentProps,
                  cachedClientModule: cachedModule?.type === "component"
                    ? cachedModule.code
                    : undefined,
                  moduleServerUrl: this.moduleServerUrl,
                  moduleServerOrigin: options?.url?.origin,
                  projectId: options?.projectId,
                  studioEmbed: options?.studioEmbed,
                  mode: this.mode,
                  environment: options?.environment ?? this.environment,
                  contentSourceId: options?.contentSourceId,
                  reactVersion,
                  dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
                  dependencyPinningDependencies: options?.dependencyPinningDependencies,
                  dependencyPinningSource: options?.dependencyPinningSource,
                  serverExternalPackages: this.config.build?.serverExternalPackages,
                  signal: options?.abortSignal,
                },
              ),
            { "render.component_path": pageInfo.entity.path },
          );

          return {
            pageElement: result.pageElement,
            pageBundle: result.pageBundle,
            clientModuleCode: result.pageBundle.clientModuleCode ?? cachedModule?.code,
            pageModuleType: "component",
            collectedMetadata: {},
          };
        }

        const mdxResult = await withSpan(
          "render.handle_mdx",
          async () =>
            handleMDXPage(
              pageInfo,
              slug,
              this.projectDir,
              await this.getMergedComponents(
                options?.dependencyPinningCacheKey,
                options?.dependencyPinningDependencies,
                options?.dependencyPinningSource,
                options?.url?.origin,
                options?.environment ?? this.environment,
              ),
              this.compileMDX,
              this.adapter,
              {
                params: options?.params,
                url: options?.url,
                precompiledModule: cachedModule?.type === "mdx" ? cachedModule.code : undefined,
                projectId: options?.projectId,
                studioEmbed: options?.studioEmbed,
                projectSlug: options?.projectSlug,
                contentSourceId: options?.contentSourceId,
                reactVersion,
                serverExternalPackages: this.config.build?.serverExternalPackages,
                dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
                dependencyPinningDependencies: options?.dependencyPinningDependencies,
                dependencyPinningSource: options?.dependencyPinningSource,
                isLocalProject: this.isLocalProject,
              },
            ),
          { "render.mdx_path": pageInfo.entity.path },
        );

        return {
          pageElement: mdxResult.pageElement,
          pageBundle: mdxResult.pageBundle,
          clientModuleCode: mdxResult.pageBundle.clientModuleCode,
          pageModuleType: "mdx",
          collectedMetadata: mdxResult.collectedMetadata,
        };
      },
      {
        "render.page_type": pageType.type,
        "render.slug": slug,
        "render.path": pageInfo.entity.path,
        "render.has_cached_module": !!cachedModule,
      },
    );
  }

  getPageType(pageInfo: EntityInfo): {
    type: "mdx" | "component" | "script";
    extension: string;
    description: string;
  } {
    const detected = this.detectPageType(pageInfo);

    const descriptions: Record<typeof detected.type, string> = {
      mdx: "MDX content page with React components",
      component: "React component page (TSX/JSX)",
      script: "Script page returning Response (TS/JS)",
    };

    return { ...detected, description: descriptions[detected.type] };
  }

  validatePageBundle(result: PageBundleResult, slug: string): void {
    if (result.scriptResult) return;
    if (result.pageElement && result.pageBundle) return;

    throw RENDER_ERROR.create({
      detail: "Failed to prepare page bundle",
      context: {
        slug,
        hasElement: !!result.pageElement,
        hasBundle: !!result.pageBundle,
      },
    });
  }
}
