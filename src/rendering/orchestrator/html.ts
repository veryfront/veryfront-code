import { join } from "@veryfront/platform/compat/path-helper.ts";
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
import type { RenderOptions } from "./types.ts";
import { injectElementSelectors } from "@veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "@veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "@veryfront/core/utils/route-path-utils.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";

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

  /** Generate HTML stream for streaming SSR by wrapping React stream with shell. */
  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    logger.debug("[HTMLGenerator] generateHTMLStream context.options", {
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      hasOptions: !!context.options,
    });
    const mergedFrontmatter = this.mergeFrontmatter(
      context as HTMLGenerationContext,
    );
    const htmlOptions = await this.buildHTMLOptions(
      context as HTMLGenerationContext,
      mergedFrontmatter,
    );

    // Buffer the React stream to extract head elements
    // This is necessary because head elements need to be moved from body to <head>
    const response = new Response(reactStream);
    const reactContent = await response.text();

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
    const pagePath = context.pageInfo.entity.path;
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      // Match 'use client' or "use client" at start of line
      isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);
      if (isClientPage) {
        logger.debug(`[HTMLGenerator] Detected 'use client' page: ${pagePath}`);
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
    logger.debug("Merged frontmatter for wrapInHTMLShell:", mergedFrontmatter);

    const htmlOptions = await this.buildHTMLOptions(context, mergedFrontmatter);

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

  private resolveAppPath(): Promise<string | null> {
    return resolveAppComponentPath(
      this.config.projectDir,
      this.config.adapter,
      this.config.config,
    );
  }

  private async loadProjectFile(filename: string): Promise<string | undefined> {
    try {
      const filePath = join(this.config.projectDir, filename);
      const content = await this.config.adapter.fs.readFile(filePath);
      logger.debug(`[HTMLGenerator] Loaded ${filename}`, { length: content.length });
      return content;
    } catch {
      logger.debug(`[HTMLGenerator] No ${filename} found, using default`);
      return undefined;
    }
  }

  private async buildHTMLOptions(
    context: HTMLGenerationContext,
    mergedFrontmatter: MDXFrontmatter,
  ): Promise<HTMLGenerationOptions> {
    const appComponentPath = await this.resolveAppPath() ?? undefined;
    logger.debug("[HTMLGenerator] App component resolution", {
      appComponentPath,
      projectDir: this.config.projectDir,
      hasConfig: !!this.config.config,
      configApp: this.config.config?.app,
    });
    const globalCSS = await this.loadProjectFile("globals.css");
    const tailwindConfigJs = await this.loadProjectFile("tailwind.config.js");

    const pagePath = extractRelativePath(context.pageInfo.entity.path, this.config.projectDir);
    const sourceHash = context.options?.studioEmbed && context.pageInfo.entity.content
      ? computeSourceHash(context.pageInfo.entity.content)
      : undefined;

    return {
      mode: this.config.mode,
      config: this.config.config,
      projectDir: this.config.projectDir,
      nestedLayouts: context.nestedLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      providerPaths: context.providerInfos.map((p) => p.entity.path),
      appPath: appComponentPath,
      pagePath,
      nonce: context.options?.nonce,
      globalCSS,
      tailwindConfigJs,
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
      proxyEnvironment: context.options?.proxyEnvironment,
      headings: context.pageBundle.headings,
    };
  }
}
