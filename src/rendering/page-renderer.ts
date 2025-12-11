
import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { createDefaultMDXComponents } from "./utils/index.ts";
import type { EntityInfo } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { ComponentProps, MDXComponents, PageBundle } from "@veryfront/types";
import { handleComponentPage } from "./component-handling.ts";
import { handleMDXPage } from "./page-rendering.ts";
import { handleScriptPage } from "./script-page-handling.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { ComponentRegistry } from "./ssr/component-registry.ts";
import type { RenderResult } from "./orchestrator/types.ts";

export interface PageRenderOptions {
  params?: Record<string, string | string[]>;
  props?: ComponentProps;
  nonce?: string;
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
    const components = this.componentRegistry.getAllAsComponents();
    const defaultComponents = createDefaultMDXComponents();
    return { ...defaultComponents, ...components };
  }

  private detectPageType(pageInfo: EntityInfo): {
    type: "mdx" | "component" | "script";
    extension: string;
  } {
    const parts = pageInfo.entity.id.split(".");
    const lastPart = parts[parts.length - 1];
    const fileExtension = parts.length > 1 && lastPart ? lastPart.toLowerCase() : "";

    const isComponentPage = fileExtension === "tsx" || fileExtension === "jsx";
    const isScriptPage = fileExtension === "ts" || fileExtension === "js";

    if (isComponentPage) {
      return { type: "component", extension: fileExtension };
    } else if (isScriptPage) {
      return { type: "script", extension: fileExtension };
    } else {
      return { type: "mdx", extension: fileExtension };
    }
  }

  async preparePageBundles(
    pageInfo: EntityInfo,
    slug: string,
    cachedModule: RenderResult["pageModule"] | undefined,
    options?: PageRenderOptions,
  ): Promise<PageBundleResult> {
    const mergedComponents = this.getMergedComponents();
    const pageType = this.detectPageType(pageInfo);

    logger.debug(`Page file info:`, {
      id: pageInfo.entity.id,
      extension: pageType.extension,
      type: pageType.type,
      slug,
    });

    let pageElement: React.ReactElement | undefined;
    let pageBundle: PageBundle | undefined;
    let clientModuleCode: string | undefined = cachedModule?.code;
    let pageModuleType: "mdx" | "component" | undefined = cachedModule?.type;
    let collectedMetadata: Record<string, unknown> = {};

    switch (pageType.type) {
      case "component": {
        const componentProps = {
          ...options?.props,
          ...(options?.params ? { params: options.params } : {}),
        };

        const result = await handleComponentPage(
          pageInfo,
          slug,
          this.projectDir,
          this.componentRegistry,
          this.adapter,
          {
            props: componentProps,
            cachedClientModule: cachedModule?.type === "component" ? cachedModule.code : undefined,
            moduleServerUrl: this.moduleServerUrl,
          },
        );
        pageElement = result.pageElement;
        pageBundle = result.pageBundle;
        clientModuleCode = result.pageBundle.clientModuleCode ?? clientModuleCode;
        pageModuleType = "component";
        break;
      }

      case "script": {
        const scriptResult = await handleScriptPage(pageInfo, slug, {
          mode: this.mode,
          config: this.config,
          projectDir: this.projectDir,
          adapter: this.adapter,
          params: options?.params,
          props: options?.props,
          nonce: options?.nonce,
        });
        return {
          collectedMetadata: {},
          scriptResult,
        };
      }

      case "mdx":
      default: {
        const mdxResult = await handleMDXPage(
          pageInfo,
          slug,
          this.projectDir,
          mergedComponents,
          this.compileMDX,
          this.adapter,
          {
            params: options?.params,
            precompiledModule: cachedModule?.type === "mdx" ? cachedModule.code : undefined,
          },
        );
        pageElement = mdxResult.pageElement;
        pageBundle = mdxResult.pageBundle;
        collectedMetadata = mdxResult.collectedMetadata;
        clientModuleCode = mdxResult.pageBundle.clientModuleCode;
        pageModuleType = "mdx";
        break;
      }
    }

    return {
      pageElement,
      pageBundle,
      clientModuleCode,
      pageModuleType,
      collectedMetadata,
    };
  }

  getPageType(pageInfo: EntityInfo): {
    type: "mdx" | "component" | "script";
    extension: string;
    description: string;
  } {
    const detected = this.detectPageType(pageInfo);

    const descriptions = {
      mdx: "MDX content page with React components",
      component: "React component page (TSX/JSX)",
      script: "Script page returning Response (TS/JS)",
    };

    return {
      ...detected,
      description: descriptions[detected.type],
    };
  }

  validatePageBundle(result: PageBundleResult, slug: string): void {
    if (result.scriptResult) {
      return;
    }

    if (!result.pageElement || !result.pageBundle) {
      throw new VeryfrontError(
        "Failed to prepare page bundle",
        ErrorCode.RENDER_ERROR,
        { slug, hasElement: !!result.pageElement, hasBundle: !!result.pageBundle },
      );
    }
  }
}
