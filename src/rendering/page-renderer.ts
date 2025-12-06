/**
 * Page Renderer
 *
 * Handles preparation and dispatching of different page types (MDX, Component, Script).
 * Manages client module code generation and page bundle creation.
 */

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

/**
 * PageRenderer - Handles page type detection and rendering
 *
 * This class manages the preparation of different page types:
 * - MDX pages (.mdx files)
 * - Component pages (.tsx, .jsx files)
 * - Script pages (.ts, .js files that return Response)
 *
 * It dispatches to the appropriate handler and manages client module code.
 */
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

  /**
   * Get merged MDX components (default + registered)
   */
  private getMergedComponents(): MDXComponents {
    const components = this.componentRegistry.getAllAsComponents();
    const defaultComponents = createDefaultMDXComponents();
    return { ...defaultComponents, ...components };
  }

  /**
   * Detect page type from file extension
   */
  private detectPageType(pageInfo: EntityInfo): {
    type: "mdx" | "component" | "script";
    extension: string;
  } {
    // More explicit array access - handles edge cases safely
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

  /**
   * Prepare page bundles based on file type
   * Handles MDX, TSX/JSX components, and TS/JS scripts
   *
   * @param pageInfo - The page entity information
   * @param slug - The page slug
   * @param cachedModule - Optional cached module code
   * @param options - Rendering options (params, props)
   * @returns Page bundle result with element, metadata, and client code
   */
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

    // Initialize result
    let pageElement: React.ReactElement | undefined;
    let pageBundle: PageBundle | undefined;
    let clientModuleCode: string | undefined = cachedModule?.code;
    let pageModuleType: "mdx" | "component" | undefined = cachedModule?.type;
    let collectedMetadata: Record<string, unknown> = {};

    // Dispatch to appropriate handler based on page type
    switch (pageType.type) {
      case "component": {
        // For App Router pages, params should be passed as props
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
        // Script pages return early with their own result
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

  /**
   * Get page type information
   */
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

  /**
   * Validate that page bundle was successfully created
   */
  validatePageBundle(result: PageBundleResult, slug: string): void {
    // Script pages are valid even without element/bundle
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
