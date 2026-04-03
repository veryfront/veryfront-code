import { join } from "#veryfront/compat/path";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  buildImportMapJson,
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
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import type { RenderOptions } from "./types.ts";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.ts";
import { profilePhase, profileSyncPhase } from "#veryfront/observability/request-profiler.ts";
import {
  normalizeCssModuleKey,
  rewriteCssModuleContent,
} from "#veryfront/transforms/css-modules/naming.ts";
import { getProjectCSS } from "#veryfront/html/styles-builder/index.ts";
import { warmPreparedCSSArtifactFromFiles } from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { getRouteCandidates } from "./css-candidate-manifest.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";

const logger = rendererLogger.component("html-generator");
type ProjectCSSResult = Awaited<ReturnType<typeof getProjectCSS>> | null;

function applyExplicitThemeToDocument(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
): string {
  if (!enabled || !colorScheme) return html;

  return html.replace(/<html\b([^>]*)>/i, (_match, attrs: string) => {
    let nextAttrs = attrs;

    if (/\sdata-theme\s*=/i.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(/\sdata-theme\s*=\s*(["']).*?\1/i, "");
    }
    nextAttrs += ` data-theme="${colorScheme}"`;

    const styleMatch = nextAttrs.match(/\sstyle\s*=\s*(["'])(.*?)\1/i);
    if (styleMatch) {
      let styleValue = (styleMatch[2] ?? "").trim();

      if (/color-scheme\s*:/i.test(styleValue)) {
        styleValue = styleValue.replace(
          /color-scheme\s*:\s*[^;]+/i,
          `color-scheme: ${colorScheme}`,
        );
      } else {
        styleValue = styleValue
          ? `${styleValue.replace(/;?\s*$/, ";")} color-scheme: ${colorScheme};`
          : `color-scheme: ${colorScheme};`;
      }

      nextAttrs = nextAttrs.replace(styleMatch[0], ` style="${styleValue}"`);
    } else {
      nextAttrs += ` style="color-scheme: ${colorScheme};"`;
    }

    return `<html${nextAttrs}>`;
  });
}

function injectThemePersistenceScript(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
  nonce?: string,
): string {
  if (!enabled || !colorScheme || !/<\/head>/i.test(html)) return html;
  if (html.includes(`localStorage.setItem('theme','${colorScheme}')`)) return html;

  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const script = `<script${nonceAttr}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){/* SILENT: localStorage may be unavailable */}})();
</script>`;

  return html.replace(/<\/head>/i, `${script}\n</head>`);
}

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
    const finalHtml = context.options?.studioEmbed ? injectElementSelectors(html) : html;

    if (context.options?.studioEmbed) {
      logger.debug("Injected element selectors for Studio");
    }

    return addNonceToHtmlTags(finalHtml, context.options?.nonce);
  }

  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const fullContext = context as HTMLGenerationContext;
    const mergedFrontmatter = this.mergeFrontmatter(fullContext);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(fullContext, mergedFrontmatter),
    );
    const projectCSSPromise = this.startProjectCSSPreparation(fullContext, htmlOptions);
    this.startPreparedCSSWarmup(fullContext, htmlOptions);

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

    if (isFullHTMLDocument(reactContent)) {
      const encoder = new TextEncoder();
      const fullHtml = addNonceToHtmlTags(
        await this.handleFullHTMLDocument({
          ...fullContext,
          html: reactContent,
        }),
        context.options?.nonce,
      );

      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(fullHtml));
          controller.close();
        },
      });
    }

    const { start, end } = await profilePhase(
      "html.generate_shell_parts",
      () =>
        this.generateShellParts(
          fullContext,
          mergedFrontmatter,
          htmlOptions,
          reactContent,
          projectCSSPromise,
        ),
    );

    const encoder = new TextEncoder();
    const fullHtml = addNonceToHtmlTags(
      `${start}${reactContent}${end}`,
      context.options?.nonce,
    );

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
    const [isClientPage, importMapJson] = await Promise.all([
      this.detectUseClientDirective(pagePath),
      buildImportMapJson({
        projectDir: this.config.projectDir,
        config: this.config.config,
      }),
    ]);

    const themedHtml = injectThemePersistenceScript(
      applyExplicitThemeToDocument(
        context.html,
        context.options?.colorScheme,
        context.options?.colorSchemeFromParam,
      ),
      context.options?.colorScheme,
      context.options?.colorSchemeFromParam,
      context.options?.nonce,
    );

    const injectedHtml = injectHTMLContent(themedHtml, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath,
      projectDir: this.config.projectDir,
      isClientPage,
      environment: context.options?.environment,
      isLocalProject: this.config.mode === "development",
      nonce: context.options?.nonce,
      importMapJson,
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
    } catch (_) {
      /* expected: file may not exist for directive detection */
      logger.debug(
        `[HTMLGenerator] Could not read page file for directive detection: ${pagePath}`,
      );
      return false;
    }
  }

  private async wrapHTMLFragment(context: HTMLGenerationContext): Promise<string> {
    const mergedFrontmatter = this.mergeFrontmatter(context);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(context, mergedFrontmatter),
    );
    const projectCSSPromise = this.startProjectCSSPreparation(context, htmlOptions);
    this.startPreparedCSSWarmup(context, htmlOptions);
    const reactContent = context.html.trim();

    const { start, end } = await profilePhase(
      "html.generate_shell_parts",
      () =>
        this.generateShellParts(
          context,
          mergedFrontmatter,
          htmlOptions,
          reactContent,
          projectCSSPromise,
        ),
    );

    return `${start}${reactContent}${end}`;
  }

  private async generateShellParts(
    context: HTMLGenerationContext,
    mergedFrontmatter: MDXFrontmatter,
    htmlOptions: HTMLGenerationOptions,
    reactContent: string,
    projectCSSPromise?: Promise<ProjectCSSResult>,
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
      projectCSSPromise,
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

  private startProjectCSSPreparation(
    context: HTMLGenerationContext,
    htmlOptions: HTMLGenerationOptions,
  ): Promise<ProjectCSSResult> | undefined {
    const isLocalProject = htmlOptions.isLocalProject ?? false;
    if (isLocalProject || htmlOptions.environment !== "production") return undefined;

    const projectScope = htmlOptions.projectSlug || htmlOptions.projectId || context.slug;
    if (!projectScope || projectScope === "default") return undefined;

    return getProjectCSS(
      projectScope,
      htmlOptions.globalCSS,
      new Set([...(htmlOptions.projectClasses ?? [])]),
      {
        minify: true,
        environment: htmlOptions.environment,
        buildMode: htmlOptions.mode,
      },
    );
  }

  private startPreparedCSSWarmup(
    context: HTMLGenerationContext,
    htmlOptions: HTMLGenerationOptions,
  ): void {
    const isLocalProject = htmlOptions.isLocalProject ?? false;
    const usesPreviewStylesheet = isLocalProject || htmlOptions.environment !== "production";
    if (!usesPreviewStylesheet) return;

    const wrappedFs = this.config.adapter.fs as unknown as {
      getUnderlyingAdapter?: () => unknown;
    };
    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getAllSourceFiles?: () =>
        | Array<{ path: string; content?: string }>
        | Promise<Array<{ path: string; content?: string }>>;
    };
    if (typeof fsAdapter.getAllSourceFiles !== "function") return;

    const projectScope = htmlOptions.projectSlug || htmlOptions.projectId || context.slug;
    if (!projectScope || projectScope === "default") return;

    const projectVersion = this.getProjectContentVersion() ??
      (this.config.mode === "development" ? "dev" : "unknown");
    const styleProfile = createStyleScopeProfile(this.config.config);
    const stylesheetPath = this.config.config?.tailwind?.stylesheet;

    Promise.resolve(fsAdapter.getAllSourceFiles()).then((files) =>
      warmPreparedCSSArtifactFromFiles({
        projectSlug: projectScope,
        projectVersion,
        projectDir: this.config.projectDir,
        files,
        styleProfile,
        stylesheetPath,
        minify: true,
        environment: "preview",
        buildMode: "production",
      })
    ).catch((error) => {
      logger.debug("Prepared CSS warmup skipped after source scan failure", {
        projectScope,
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
    } catch (_) {
      /* expected: project file may not exist */
      logger.debug(`No ${filename} found, using default`);
      return undefined;
    }
  }

  private async buildHTMLOptions(
    context: HTMLGenerationContext,
    mergedFrontmatter: MDXFrontmatter,
  ): Promise<HTMLGenerationOptions> {
    const stylesheetPath = this.config.config?.tailwind?.stylesheet || "globals.css";
    const [appComponentPathOrNull, globalCSS] = await Promise.all([
      profilePhase("html.resolve_app_path", () => this.resolveAppPath()),
      profilePhase("html.load_global_css", () => this.loadProjectFile(stylesheetPath)),
    ]);
    const appComponentPath = appComponentPathOrNull ?? undefined;
    const projectClasses = await profilePhase(
      "html.route_candidates",
      () => this.extractProjectClassesForRoute(context, appComponentPath),
    );

    // Load CSS imported by components and merge with globalCSS.
    // Deduplicate against the configured stylesheet to avoid double-loading.
    const combinedCSS = await profilePhase(
      "html.merge_imported_css",
      () => this.mergeImportedCSS(globalCSS, context.cssImports, stylesheetPath),
    );

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

    return profileSyncPhase("html.build_options.finalize", () => ({
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
      projectSlug: context.options?.projectSlug,
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
      forceProductionScripts: context.options?.forceProductionScripts,
    }));
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
      } catch (_) {
        /* expected: imported CSS file may not exist */
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
      getContentContext?: () => ResolvedContentContext | null;
      getProjectData?: () => { updated_at?: string } | undefined;
    };

    const contentContext = typeof fsAdapter.getContentContext === "function"
      ? fsAdapter.getContentContext()
      : null;

    if (contentContext) return resolveStyleContentVersion(contentContext);

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
      styleProfile: createStyleScopeProfile(this.config.config),
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
