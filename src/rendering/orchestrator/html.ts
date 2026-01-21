import { join } from "#veryfront/platform/compat/path-helper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
} from "#veryfront/html";
import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type {
  EntityInfo,
  LayoutItem,
  MdxBundle,
  MDXFrontmatter,
  PageBundle,
} from "#veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "#veryfront/utils";
import type { RenderOptions } from "./types.ts";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.ts";

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
  collectedHead?: CollectedHead;
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
   * Generate HTML stream for streaming SSR.
   *
   * Buffers React stream with timeout protection, then generates Tailwind CSS
   * from the content. If timeout occurs, uses partial content for CSS generation.
   * This ensures styles work without JS while preventing indefinite blocking.
   */
  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const mergedFrontmatter = this.mergeFrontmatter(context as HTMLGenerationContext);
    const htmlOptions = await this.buildHTMLOptions(
      context as HTMLGenerationContext,
      mergedFrontmatter,
    );

    // Buffer stream with timeout protection
    // If timeout, use partial content - better than blocking forever
    let reactContent: string;
    try {
      reactContent = (await streamToString(reactStream)).trim();
    } catch (error) {
      if (error instanceof StreamTimeoutError) {
        logger.warn("[HTMLGenerator] Stream timed out, using partial content", {
          partialLength: error.partialContent.length,
        });
        reactContent = error.partialContent.trim();
      } else {
        throw error;
      }
    }

    // Use collected head data from HeadCollector (collected during SSR render)
    const head = context.collectedHead;
    const effectiveTitle = head?.title || mergedFrontmatter.title || "Veryfront App";
    const effectiveDescription = head?.description || mergedFrontmatter.description || "";
    const enrichedFrontmatter = {
      ...mergedFrontmatter,
      ...(head?.title && { title: head.title }),
      ...(head?.description && { description: head.description }),
    };

    // Generate Tailwind CSS from content (works even with partial content on timeout)
    const { start, end } = await generateHTMLShellParts(
      {
        title: effectiveTitle,
        description: effectiveDescription,
        slug: context.slug,
        frontmatter: enrichedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
      reactContent,
    );

    // Build additional head elements from collected data
    const headElements = this.buildHeadElements(head);
    const startWithHeadElements = headElements
      ? start.replace("</head>", `  ${headElements}\n</head>`)
      : start;

    const encoder = new TextEncoder();
    const fullHtml = `${startWithHeadElements}${reactContent}${end}`;

    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(fullHtml));
        controller.close();
      },
    });
  }

  /** Convert collected head data to HTML string for injection into <head>. */
  private buildHeadElements(head?: CollectedHead): string {
    if (!head) return "";

    const parts: string[] = [];

    // Add meta tags (skip description - handled by shell)
    for (const meta of head.metas) {
      if (meta.name === "description") continue;
      const attrs: string[] = [];
      if (meta.name) attrs.push(`name="${meta.name}"`);
      if (meta.property) attrs.push(`property="${meta.property}"`);
      if (meta.content) attrs.push(`content="${meta.content}"`);
      if (attrs.length) parts.push(`<meta ${attrs.join(" ")}>`);
    }

    // Add link tags
    for (const link of head.links) {
      const attrs = Object.entries(link)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      if (attrs) parts.push(`<link ${attrs}>`);
    }

    // Add style tags
    for (const style of head.styles) {
      parts.push(`<style>${style}</style>`);
    }

    return parts.join("\n  ");
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
    const htmlOptions = await this.buildHTMLOptions(context, mergedFrontmatter);
    const reactContent = context.html.trim();

    // Use collected head data from HeadCollector
    const head = context.collectedHead;
    const effectiveTitle = head?.title || mergedFrontmatter.title || "Veryfront App";
    const effectiveDescription = head?.description || mergedFrontmatter.description || "";
    const enrichedFrontmatter = {
      ...mergedFrontmatter,
      ...(head?.title && { title: head.title }),
      ...(head?.description && { description: head.description }),
    };

    const { start, end } = await generateHTMLShellParts(
      {
        title: effectiveTitle,
        description: effectiveDescription,
        slug: context.slug,
        frontmatter: enrichedFrontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
      reactContent,
    );

    // Build additional head elements from collected data
    const headElements = this.buildHeadElements(head);
    const startWithHeadElements = headElements
      ? start.replace("</head>", `  ${headElements}\n</head>`)
      : start;

    return `${startWithHeadElements}${reactContent}${end}`;
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
    // Load app path and global CSS in parallel
    // Note: tailwind.config.js is not loaded - Tailwind v4 uses CSS @theme directive instead
    const [appComponentPath, globalCSS] = await Promise.all([
      this.resolveAppPath().then((p) => p ?? undefined),
      this.loadProjectFile("globals.css"),
    ]);
    logger.debug("[HTMLGenerator] App component resolution", {
      appComponentPath,
      projectDir: this.config.projectDir,
      hasConfig: !!this.config.config,
      configApp: this.config.config?.app,
    });

    const pagePath = extractRelativePath(context.pageInfo.entity.path, this.config.projectDir);
    const sourceHash = context.options?.studioEmbed && context.pageInfo.entity.content
      ? computeSourceHash(context.pageInfo.entity.content)
      : undefined;

    // Get cached project classes from the adapter (if available)
    // This ensures CSS includes all classes from source files, not just SSR HTML
    const projectClasses = this.getProjectClasses();

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
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
      colorSchemeFromParam: context.options?.colorSchemeFromParam,
      proxyEnvironment: context.options?.proxyEnvironment,
      headings: context.pageBundle.headings,
      projectClasses,
    };
  }

  /**
   * Get cached project classes from the adapter.
   * Returns undefined if adapter doesn't support class caching.
   */
  private getProjectClasses(): Set<string> | undefined {
    // Check if adapter has getCachedClasses method (VeryfrontFSAdapter)
    const adapter = this.config.adapter as unknown as {
      getCachedClasses?: () => Set<string> | undefined;
    };
    if (typeof adapter.getCachedClasses === "function") {
      return adapter.getCachedClasses();
    }
    return undefined;
  }
}
