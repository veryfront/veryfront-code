import { join } from "../../platform/compat/path-helper.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { HTMLGenerationOptions } from "@veryfront/html";
import {
  extractHeadElements,
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
  wrapInHTMLShell,
} from "@veryfront/html";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type {
  EntityInfo,
  LayoutItem,
  MdxBundle,
  MDXFrontmatter,
  PageBundle,
} from "@veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "@veryfront/utils";
import { detectAppRouter } from "../router-detection.ts";
import type { RenderOptions } from "./types.ts";
import { injectElementSelectors } from "../../studio/element-selector-injector.ts";
import { computeSourceHash } from "../../studio/hash-utils.ts";
import { extractRelativePath } from "@veryfront/core/utils/route-path-utils.ts";

export interface HTMLGeneratorConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
}

export interface HTMLGenerationContext {
  html: string;
  pageInfo: EntityInfo;
  pageBundle: PageBundle;
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
  providerInfos: EntityInfo[];
  collectedMetadata: Record<string, unknown>;
  slug: string;
  ssrHash: string;
  options?: RenderOptions;
}

export class HTMLGenerator {
  private config: HTMLGeneratorConfig;

  constructor(config: HTMLGeneratorConfig) {
    this.config = config;
  }

  async generateFullHTML(context: HTMLGenerationContext): Promise<string> {
    let html: string;

    if (isFullHTMLDocument(context.html)) {
      html = await this.handleFullHTMLDocument(context);
    } else {
      html = await this.wrapHTMLFragment(context);
    }

    // Inject element selectors for Studio Navigator when in studio embed mode
    if (context.options?.studioEmbed) {
      html = injectElementSelectors(html);
      logger.debug("[HTMLGenerator] Injected element selectors for Studio");
    }

    return html;
  }

  /**
   * Generate HTML stream for streaming SSR
   * Wraps the React stream with HTML shell parts
   */
  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    logger.info("[HTMLGenerator] generateHTMLStream context.options", {
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      hasOptions: !!context.options,
    });
    const mergedFrontmatter = this.mergeFrontmatter(
      context as HTMLGenerationContext,
    );
    const useAppRouter = await detectAppRouter(
      this.config.projectDir,
      this.config.config,
      this.config.adapter,
    );
    const appComponentPath = await this.resolveAppComponentPath(useAppRouter);

    // Load project's globals.css for custom theme variables
    let globalCSS: string | undefined;
    try {
      const globalsCSSPath = join(this.config.projectDir, "globals.css");
      globalCSS = await this.config.adapter.fs.readFile(globalsCSSPath);
      logger.debug("[HTMLGenerator] Loaded globals.css", { length: globalCSS.length });
    } catch {
      logger.debug("[HTMLGenerator] No globals.css found, using default theme");
    }

    // Load project's tailwind.config.js for runtime config
    let tailwindConfigJs: string | undefined;
    try {
      const tailwindConfigPath = join(this.config.projectDir, "tailwind.config.js");
      tailwindConfigJs = await this.config.adapter.fs.readFile(tailwindConfigPath);
      logger.debug("[HTMLGenerator] Loaded tailwind.config.js", {
        length: tailwindConfigJs.length,
      });
    } catch {
      logger.debug("[HTMLGenerator] No tailwind.config.js found, using default config");
    }

    // Extract page path from entity id (the actual file path) for client-side module loading
    // This ensures the client can correctly import the page module during hydration/SPA navigation
    const pagePath = extractRelativePath(context.pageInfo.entity.id, this.config.projectDir);

    // Compute source hash for Navigator tree sync detection (only in studio embed mode)
    const sourceHash = context.options?.studioEmbed && context.pageInfo.entity.content
      ? computeSourceHash(context.pageInfo.entity.content)
      : undefined;

    const htmlOptions: HTMLGenerationOptions = {
      mode: this.config.mode,
      config: this.config.config,
      projectDir: this.config.projectDir,
      nestedLayouts: context.nestedLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      providerPaths: context.providerInfos.map((p) => p.entity.id),
      appPath: appComponentPath,
      pagePath: pagePath,
      nonce: context.options?.nonce,
      globalCSS,
      tailwindConfigJs,
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
    };

    // Buffer the React stream to extract head elements
    // This is necessary because head elements need to be moved from body to <head>
    const decoder = new TextDecoder();
    const chunks: Uint8Array[] = [];
    const reader = reactStream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks and extract head elements
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combinedArray.set(chunk, offset);
      offset += chunk.length;
    }
    const reactContent = decoder.decode(combinedArray);

    // Extract head elements from React content (moves <link>, <meta>, etc. from body to head)
    const { headElements, cleanedContent: rawCleanedContent } = extractHeadElements(reactContent);
    // Trim leading/trailing whitespace to prevent hydration mismatch
    // React's virtual DOM doesn't include whitespace at container boundaries
    const cleanedContent = rawCleanedContent.trim();

    const { start, end } = await generateHTMLShellParts(
      {
        title: mergedFrontmatter.title || "Veryfront App",
        description: mergedFrontmatter.description || "",
        slug: context.slug,
        frontmatter: mergedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
      cleanedContent, // Pass cleaned content for Tailwind CSS generation
    );

    // Inject extracted head elements into the <head> section (before </head>)
    const startWithHeadElements = headElements
      ? start.replace("</head>", `  ${headElements}\n</head>`)
      : start;

    const encoder = new TextEncoder();
    const fullHtml = `${startWithHeadElements}${cleanedContent}${end}`;
    const htmlChunk = encoder.encode(fullHtml);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(htmlChunk);
        controller.close();
      },
    });
  }

  private async handleFullHTMLDocument(
    context: HTMLGenerationContext,
  ): Promise<string> {
    const metadata = extractHTMLMetadata(
      (context.pageInfo.entity.frontmatter || {}) as MDXFrontmatter,
      (context.layoutBundle?.frontmatter || {}) as MDXFrontmatter,
    );

    // Detect if the page has 'use client' directive for hydration
    let isClientPage = false;
    const pagePath = context.pageInfo.entity.id;
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      // Match 'use client' or "use client" at start of line
      isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);
      if (isClientPage) {
        logger.info(`[HTMLGenerator] Detected 'use client' page: ${pagePath}`);
      }
    } catch (_e) {
      logger.debug(
        `[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`,
      );
    }

    const injectedHtml = injectHTMLContent(context.html, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath, // Always provide pagePath for module resolution, not just client pages
      isClientPage,
    });

    return injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")
      ? injectedHtml
      : `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async wrapHTMLFragment(
    context: HTMLGenerationContext,
  ): Promise<string> {
    const mergedFrontmatter = this.mergeFrontmatter(context);
    logger.info("Merged frontmatter for wrapInHTMLShell:", mergedFrontmatter);

    const useAppRouter = await detectAppRouter(
      this.config.projectDir,
      this.config.config,
      this.config.adapter,
    );

    const appComponentPath = await this.resolveAppComponentPath(useAppRouter);

    // Load project's globals.css for custom theme variables
    let globalCSS: string | undefined;
    try {
      const globalsCSSPath = join(this.config.projectDir, "globals.css");
      globalCSS = await this.config.adapter.fs.readFile(globalsCSSPath);
      logger.debug("[HTMLGenerator] Loaded globals.css", { length: globalCSS.length });
    } catch {
      logger.debug("[HTMLGenerator] No globals.css found, using default theme");
    }

    // Load project's tailwind.config.js for runtime config
    let tailwindConfigJs: string | undefined;
    try {
      const tailwindConfigPath = join(this.config.projectDir, "tailwind.config.js");
      tailwindConfigJs = await this.config.adapter.fs.readFile(tailwindConfigPath);
      logger.debug("[HTMLGenerator] Loaded tailwind.config.js", {
        length: tailwindConfigJs.length,
      });
    } catch {
      logger.debug("[HTMLGenerator] No tailwind.config.js found, using default config");
    }

    // Extract page path from entity id (the actual file path) for client-side module loading
    // This ensures the client can correctly import the page module during hydration/SPA navigation
    const pagePath = extractRelativePath(context.pageInfo.entity.id, this.config.projectDir);

    // Compute source hash for Navigator tree sync detection (only in studio embed mode)
    const sourceHash = context.options?.studioEmbed && context.pageInfo.entity.content
      ? computeSourceHash(context.pageInfo.entity.content)
      : undefined;

    const htmlOptions: HTMLGenerationOptions = {
      mode: this.config.mode,
      config: this.config.config,
      projectDir: this.config.projectDir,
      nestedLayouts: context.nestedLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      providerPaths: context.providerInfos.map((p) => p.entity.id),
      appPath: appComponentPath,
      pagePath: pagePath,
      nonce: context.options?.nonce,
      globalCSS,
      tailwindConfigJs,
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
    };

    return await wrapInHTMLShell(
      context.html,
      {
        title: mergedFrontmatter.title || "Veryfront App",
        description: mergedFrontmatter.description || "",
        slug: context.slug,
        frontmatter: mergedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
    );
  }

  private mergeFrontmatter(context: HTMLGenerationContext): MDXFrontmatter {
    return {
      ...context.pageInfo.entity.frontmatter,
      ...(context.pageBundle as MdxBundle).frontmatter,
      ...(context.collectedMetadata || {}),
    } as MDXFrontmatter;
  }

  private async resolveAppComponentPath(
    useAppRouter: boolean,
  ): Promise<string | undefined> {
    if (useAppRouter) {
      return undefined;
    }

    const appPath = join(this.config.projectDir, "components/app.tsx");
    const appExists = await this.config.adapter.fs.exists(appPath);
    return appExists ? appPath : undefined;
  }
}
