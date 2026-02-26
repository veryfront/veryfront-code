import { join } from "#veryfront/compat/path";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
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
import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import type { RenderOptions } from "./types.ts";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.ts";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";
import { getRouteCandidates } from "./css-candidate-manifest.ts";

const logger = rendererLogger.component("html-generator");

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
  /** Absolute paths to CSS files imported by components (collected during module loading) */
  cssImports?: string[];
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

    logger.debug("Injected element selectors for Studio");
    return injectElementSelectors(html);
  }

  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const fullContext = context as HTMLGenerationContext;
    const mergedFrontmatter = this.mergeFrontmatter(fullContext);
    const htmlOptions = await this.buildHTMLOptions(fullContext, mergedFrontmatter);

    let reactContent: string;
    try {
      reactContent = (await streamToString(reactStream)).trim();
    } catch (error) {
      if (!(error instanceof StreamTimeoutError)) throw error;

      logger.warn("Stream timed out, using partial content", {
        partialLength: error.partialContent.length,
      });
      reactContent = error.partialContent.trim();
    }

    const { start, end } = await this.generateShellParts(
      fullContext,
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

    const pagePath = context.pageInfo.entity.path;
    const isClientPage = await this.detectUseClientDirective(pagePath);

    const injectedHtml = injectHTMLContent(context.html, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath,
      isClientPage,
    });

    if (injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")) return injectedHtml;

    return `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async detectUseClientDirective(pagePath: string): Promise<boolean> {
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      const isClientPage = /^\s*['"]use client['"];?\s*$/m.test(pageContent);

      if (isClientPage) {
        logger.debug(`Detected 'use client' page: ${pagePath}`);
      }

      return isClientPage;
    } catch {
      logger.debug(
        `[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`,
      );
      return false;
    }
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

    const { scripts, other } = this.buildHeadElements(head);
    if (!scripts && !other) return { start, end };

    let modifiedStart = start;

    // Inject blocking scripts at TOP of <head> (after opening tag, before meta/CSS)
    if (scripts) {
      modifiedStart = modifiedStart.replace("<head>", `<head>\n  ${scripts}`);
    }

    // Inject other head elements at BOTTOM of <head> (before closing tag)
    // Use lastIndexOf to avoid matching </head> inside inline script content
    if (other) {
      const headCloseIdx = modifiedStart.lastIndexOf("</head>");
      if (headCloseIdx !== -1) {
        modifiedStart = modifiedStart.slice(0, headCloseIdx) +
          `  ${other}\n` +
          modifiedStart.slice(headCloseIdx);
      }
    }

    return { start: modifiedStart, end };
  }

  private buildHeadElements(head?: CollectedHead): { scripts: string; other: string } {
    if (!head) return { scripts: "", other: "" };

    const scriptParts: string[] = [];
    const otherParts: string[] = [];

    // Scripts go at TOP of head (before CSS) to prevent flash
    for (const script of head.scripts ?? []) {
      const { content, ...attrs } = script;
      const attrPairs: [string, string][] = [["data-vf-head", "true"]];

      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) attrPairs.push([k, v]);
      }

      // For inline scripts without id, add hash for client-side deduplication
      if (content && !attrs.id) {
        let sum = 0;
        for (let i = 0; i < Math.min(content.length, 200); i++) {
          sum = ((sum << 5) - sum + content.charCodeAt(i)) | 0;
        }
        attrPairs.push(["data-vf-hash", "vf" + Math.abs(sum).toString(36)]);
      }

      const attrStr = attrPairs.map(([k, v]) => `${k}="${v}"`).join(" ");
      if (content) {
        scriptParts.push(`<script ${attrStr}>${content}</script>`);
      } else if (attrs.src) {
        scriptParts.push(`<script ${attrStr}></script>`);
      }
    }

    for (const meta of head.metas) {
      if (meta.name === "description") continue;

      const attrs: string[] = [];
      if (meta.name) attrs.push(`name="${meta.name}"`);
      if (meta.property) attrs.push(`property="${meta.property}"`);
      if (meta.content) attrs.push(`content="${meta.content}"`);
      if (attrs.length) otherParts.push(`<meta ${attrs.join(" ")}>`);
    }

    for (const link of head.links) {
      const attrs = Object.entries(link)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      if (attrs) otherParts.push(`<link ${attrs}>`);
    }

    for (const style of head.styles) {
      otherParts.push(`<style>${style}</style>`);
    }

    return {
      scripts: scriptParts.join("\n  "),
      other: otherParts.join("\n  "),
    };
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
      logger.debug(`Loaded ${filename}`, { length: content.length });
      return content;
    } catch {
      logger.debug(`No ${filename} found, using default`);
      return undefined;
    }
  }

  private async buildHTMLOptions(
    context: HTMLGenerationContext,
    mergedFrontmatter: MDXFrontmatter,
  ): Promise<HTMLGenerationOptions> {
    const stylesheetPath = this.config.config?.tailwind?.stylesheet || "globals.css";
    const [appComponentPath, globalCSS] = await Promise.all([
      this.resolveAppPath().then((p) => p ?? undefined),
      this.loadProjectFile(stylesheetPath),
    ]);
    const projectClasses = await this.extractProjectClassesForRoute(context, appComponentPath);

    // Load CSS imported by components and merge with globalCSS.
    // Deduplicate against the configured stylesheet to avoid double-loading.
    const combinedCSS = await this.mergeImportedCSS(globalCSS, context.cssImports, stylesheetPath);

    logger.debug("App component resolution", {
      appComponentPath,
      projectDir: this.config.projectDir,
      hasConfig: !!this.config.config,
      configApp: this.config.config?.app,
    });

    const pagePath = extractRelativePath(
      context.pageInfo.entity.path,
      this.config.projectDir,
    );

    const fileExtension = getExtensionName(context.pageInfo.entity.path);
    const pageType = fileExtension as
      | "mdx"
      | "md"
      | "tsx"
      | "jsx"
      | "ts"
      | "js"
      | undefined;

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
      pageType,
      nonce: context.options?.nonce,
      globalCSS: combinedCSS,
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
      colorSchemeFromParam: context.options?.colorSchemeFromParam,
      colorSchemeFromHeader: context.options?.colorSchemeFromHeader,
      environment: context.options?.environment,
      headings: context.pageBundle.headings,
      projectClasses,
      isLocalProject: this.config.mode === "development",
      noHmr: context.options?.noHmr,
    };
  }

  /**
   * Load CSS files imported by components and merge with the global stylesheet.
   * Deduplicates against the configured Tailwind stylesheet path to avoid
   * double-loading globals.css when it's both auto-discovered and explicitly imported.
   */
  private async mergeImportedCSS(
    globalCSS: string | undefined,
    cssImports: string[] | undefined,
    stylesheetPath: string,
  ): Promise<string | undefined> {
    if (!cssImports || cssImports.length === 0) return globalCSS;

    const normalizedStylesheetPath = stylesheetPath.replace(/^\/+/, "");
    const configuredStylesheetAbsolute = normalizeCssModuleKey(
      join(this.config.projectDir, normalizedStylesheetPath),
    );
    const uniqueImports = new Map<string, string>();
    for (const cssPath of cssImports) {
      const normalized = normalizeCssModuleKey(cssPath);
      if (!uniqueImports.has(normalized)) {
        uniqueImports.set(normalized, cssPath);
      }
    }

    const sortedImports = [...uniqueImports.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const regularCssSegments: string[] = [];
    const moduleCssSegments: string[] = [];

    for (const [normalizedCssPath, cssPath] of sortedImports) {
      // Deduplicate only exact path matches to avoid skipping unrelated files
      // like /styles/globals.css when the configured stylesheet is /globals.css.
      if (normalizedCssPath === configuredStylesheetAbsolute) {
        continue;
      }

      try {
        const content = await this.config.adapter.fs.readFile(cssPath);
        if (!content) continue;

        if (normalizedCssPath.endsWith(".module.css")) {
          moduleCssSegments.push(rewriteCssModuleContent(content, normalizedCssPath));
        } else {
          regularCssSegments.push(content);
        }
      } catch {
        logger.debug("Could not load imported CSS file", { cssPath });
      }
    }

    if (regularCssSegments.length === 0 && moduleCssSegments.length === 0) return globalCSS;

    const combined = [globalCSS, ...regularCssSegments, ...moduleCssSegments]
      .filter(Boolean)
      .join("\n");
    logger.debug("Merged imported CSS with global stylesheet", {
      importedCount: regularCssSegments.length + moduleCssSegments.length,
      regularCount: regularCssSegments.length,
      moduleCount: moduleCssSegments.length,
      totalLength: combined.length,
    });
    return combined;
  }

  private getProjectContentVersion(): string | undefined {
    const wrappedFs = this.config.adapter.fs as unknown as {
      getUnderlyingAdapter?: () => unknown;
    };

    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return undefined;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getProjectData?: () => { updated_at?: string } | undefined;
    };

    return fsAdapter.getProjectData?.()?.updated_at;
  }

  private buildRouteManifestKey(pagePath: string): string {
    const relativePagePath = extractRelativePath(pagePath, this.config.projectDir);
    return relativePagePath
      .replace(/\.(tsx|ts|jsx|mdx|md|js)$/, "")
      .replace(/^pages\//, "");
  }

  private async extractProjectClassesForRoute(
    context: HTMLGenerationContext,
    appComponentPath?: string,
  ): Promise<Set<string>> {
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
    const projectScope = context.options?.projectSlug || context.options?.projectId ||
      this.config.projectDir;
    const projectVersion = this.getProjectContentVersion() ??
      (this.config.mode === "development" ? "dev" : "unknown");
    const routeKey = this.buildRouteManifestKey(context.pageInfo.entity.path);
    const routeLayoutPaths = context.nestedLayouts
      .map((layout) => layout.componentPath || layout.path)
      .filter((path): path is string => Boolean(path));
    const routeFilePaths = [
      context.pageInfo.entity.path,
      ...routeLayoutPaths,
      ...(appComponentPath ? [appComponentPath] : []),
    ];

    const routeCandidates = getRouteCandidates({
      projectScope,
      projectVersion,
      projectDir: this.config.projectDir,
      routeKey,
      routeFilePaths,
      files,
      developmentMode: this.config.mode === "development",
    });

    for (const cls of routeCandidates) classes.add(cls);

    logger.debug("extractProjectClasses", {
      filesProcessed: files.length,
      routeKey,
      routeFileCount: routeFilePaths.length,
      totalClasses: classes.size,
    });

    return classes;
  }
}
