import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
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

export interface PageRenderOptions {
  params?: Record<string, string | string[]>;
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
}

export interface PageBundleResult {
  pageElement?: React.ReactElement;
  pageBundle?: PageBundle;
  clientModuleCode?: string;
  pageModuleType?: "mdx" | "component";
  collectedMetadata: Record<string, unknown>;
  scriptResult?: RenderResult;
}

export class PageRenderer {
  private readonly projectDir: string;
  private readonly mode: string;
  private readonly config: VeryfrontConfig;
  private readonly adapter: RuntimeAdapter;
  private readonly componentRegistry: ComponentRegistry;
  private readonly compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<PageBundle>;
  private readonly moduleServerUrl?: string;

  constructor(options: {
    projectDir: string;
    mode: string;
    config: VeryfrontConfig;
    adapter: RuntimeAdapter;
    componentRegistry: ComponentRegistry;
    compileMDX: (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => Promise<PageBundle>;
    moduleServerUrl?: string;
  }) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.config = options.config;
    this.adapter = options.adapter;
    this.componentRegistry = options.componentRegistry;
    this.compileMDX = options.compileMDX;
    this.moduleServerUrl = options.moduleServerUrl;
  }

  private getMergedComponents(): MDXComponents {
    return {
      ...createDefaultMDXComponents(),
      ...this.componentRegistry.getAllAsComponents(),
    };
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
                props: options?.props,
                nonce: options?.nonce,
              }),
            { "render.script_path": pageInfo.entity.path },
          );

          return { collectedMetadata: {}, scriptResult };
        }

        if (pageType.type === "component") {
          let params = options?.params;
          if (!params || Object.keys(params).length === 0) {
            const extracted = extractRouteParams(pageInfo.entity.path, slug);
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
                  projectId: options?.projectId,
                  studioEmbed: options?.studioEmbed,
                  contentSourceId: options?.contentSourceId,
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
          () =>
            handleMDXPage(
              pageInfo,
              slug,
              this.projectDir,
              this.getMergedComponents(),
              this.compileMDX,
              this.adapter,
              {
                params: options?.params,
                precompiledModule: cachedModule?.type === "mdx" ? cachedModule.code : undefined,
                projectId: options?.projectId,
                studioEmbed: options?.studioEmbed,
                projectSlug: options?.projectSlug,
                contentSourceId: options?.contentSourceId,
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
