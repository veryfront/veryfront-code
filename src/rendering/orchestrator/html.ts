import { join } from "#veryfront/platform/compat/path-helper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
} from "#veryfront/html";
import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
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
    const html = isFullHTMLDocument(context.html)
      ? await this.handleFullHTMLDocument(context)
      : await this.wrapHTMLFragment(context);

    if (!context.options?.studioEmbed) return html;

    logger.debug("[HTMLGenerator] Injected element selectors for Studio");
    return injectElementSelectors(html);
  }

  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const mergedFrontmatter = this.mergeFrontmatter(context as HTMLGenerationContext);
    const htmlOptions = await this.buildHTMLOptions(
      context as HTMLGenerationContext,
      mergedFrontmatter,
    );

    let reactContent: string;
    try {
      reactContent = (await streamToString(reactStream)).trim();
    } catch (error) {
      if (!(error instanceof StreamTimeoutError)) throw error;

      logger.warn("[HTMLGenerator] Stream timed out, using partial content", {
        partialLength: error.partialContent.length,
      });
      reactContent = error.partialContent.trim();
    }

    const { start, end } = await this.generateShellParts(
      context as HTMLGenerationContext,
      mergedFrontmatter,
      htmlOptions,
      reactContent,
    );

    const encoder = new TextEncoder();
    const fullHtml = `${start}${reactContent}${end}`;

    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(fullHtml));
        controller.close();
      },
    });
  }

  private async handleFullHTMLDocument(context: HTMLGenerationContext): Promise<string> {
    const metadata = extractHTMLMetadata(
      (context.pageInfo.entity.frontmatter || {}) as MDXFrontmatter,
      (context.layoutBundle?.frontmatter || {}) as MDXFrontmatter,
    );

    let isClientPage = false;
    const pagePath = context.pageInfo.entity.path;

    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);
      if (isClientPage) {
        logger.debug(`[HTMLGenerator] Detected 'use client' page: ${pagePath}`);
      }
    } catch {
      logger.debug(
        `[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`,
      );
    }

    const injectedHtml = injectHTMLContent(context.html, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath,
      isClientPage,
    });

    if (injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")) {
      return injectedHtml;
    }

    return `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async wrapHTMLFragment(context: HTMLGenerationContext): Promise<string> {
    const mergedFrontmatter = this.mergeFrontmatter(context);
    const htmlOptions = await this.buildHTMLOptions(context, mergedFrontmatter);
    const reactContent = context.html.trim();

    const { start, end } = await this.generateShellParts(
      context,
      mergedFrontmatter,
      htmlOptions,
      reactContent,
    );

    return `${start}${reactContent}${end}`;
  }

  private async generateShellParts(
    context: HTMLGenerationContext,
    mergedFrontmatter: MDXFrontmatter,
    htmlOptions: HTMLGenerationOptions,
    reactContent: string,
  ): Promise<{ start: string; end: string }> {
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

    const headElements = this.buildHeadElements(head);
    if (!headElements) return { start, end };

    return {
      start: start.replace("</head>", `  ${headElements}\n</head>`),
      end,
    };
  }

  private buildHeadElements(head?: CollectedHead): string {
    if (!head) return "";

    const parts: string[] = [];

    for (const meta of head.metas) {
      if (meta.name === "description") continue;

      const attrs: string[] = [];
      if (meta.name) attrs.push(`name="${meta.name}"`);
      if (meta.property) attrs.push(`property="${meta.property}"`);
      if (meta.content) attrs.push(`content="${meta.content}"`);
      if (attrs.length) parts.push(`<meta ${attrs.join(" ")}>`);
    }

    for (const link of head.links) {
      const attrs = Object.entries(link)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      if (attrs) parts.push(`<link ${attrs}>`);
    }

    for (const style of head.styles) {
      parts.push(`<style>${style}</style>`);
    }

    return parts.join("\n  ");
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
    // Load app path, global CSS, and extract project classes in parallel
    // Note: tailwind.config.js is not loaded - Tailwind v4 uses CSS @theme directive instead
    const stylesheetPath = this.config.config?.tailwind?.stylesheet || "globals.css";
    const [appComponentPath, globalCSS, projectClasses] = await Promise.all([
      this.resolveAppPath().then((p) => p ?? undefined),
      this.loadProjectFile(stylesheetPath),
      this.extractProjectClasses(),
    ]);

    logger.debug("[HTMLGenerator] App component resolution", {
      appComponentPath,
      projectDir: this.config.projectDir,
      hasConfig: !!this.config.config,
      configApp: this.config.config?.app,
    });

    const pagePath = extractRelativePath(
      context.pageInfo.entity.path,
      this.config.projectDir,
    );

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
      environment: context.options?.environment,
      headings: context.pageBundle.headings,
      projectClasses,
    };
  }

  private async extractProjectClasses(): Promise<Set<string>> {
    const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
    const classes = new Set<string>();

    const wrappedFs = this.config.adapter.fs as unknown as {
      getUnderlyingAdapter?: () => unknown;
    };

    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return classes;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getAllSourceFiles?: () =>
        | Array<{ path: string; content?: string }>
        | Promise<Array<{ path: string; content?: string }>>;
    };

    if (typeof fsAdapter.getAllSourceFiles !== "function") return classes;

    const files = await fsAdapter.getAllSourceFiles();

    let filesProcessed = 0;
    for (const file of files) {
      if (!file.content) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

      filesProcessed++;
      for (const cls of extractCandidates(file.content)) {
        classes.add(cls);
      }
    }

    logger.debug("[HTMLGenerator] extractProjectClasses", {
      filesProcessed,
      totalClasses: classes.size,
    });

    return classes;
  }
}
