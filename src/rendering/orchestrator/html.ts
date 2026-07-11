import { join } from "#veryfront/compat/path";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  buildImportMapJson,
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
} from "#veryfront/html";
import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import type { MDXFrontmatter } from "#veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { hasUseClientDirective } from "#veryfront/rendering/rsc/page-island.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.ts";
import { profilePhase, profileSyncPhase } from "#veryfront/observability/request-profiler.ts";
import {
  extractProjectClassesForRoute,
  type ProjectCSSResult,
  startPreparedCSSWarmup,
  startProjectCSSPreparation,
} from "./html-project-css.ts";
import {
  buildHeadElements as buildCollectedHeadElements,
  mergeFrontmatter as mergeCollectedFrontmatter,
} from "./html-head.ts";
import { mergeImportedCSS as mergeImportedProjectCss } from "./html-imported-css.ts";
import type { HTMLGenerationContext, HTMLGeneratorConfig } from "./html-types.ts";
export type { HTMLGenerationContext, HTMLGeneratorConfig } from "./html-types.ts";

const logger = rendererLogger.component("html-generator");

/**
 * Resolve the release ID for manifest consumption from render options.
 *
 * Prefers an explicit `releaseId`, then derives it from a production
 * `contentSourceId` of the form `release-<id>`. Returns undefined for
 * preview/local renders so manifest consumption stays inert there.
 */
function resolveReleaseId(
  options: { releaseId?: string; contentSourceId?: string } | undefined,
): string | undefined {
  if (options?.releaseId) return options.releaseId;
  const source = options?.contentSourceId;
  if (source && source.startsWith("release-")) return source.slice("release-".length);
  return undefined;
}

type OptionsWithReleaseAssetManifest = {
  studioEmbed?: boolean;
  releaseId?: string;
  contentSourceId?: string;
  releaseAssetManifest?: ReleaseAssetManifest | null;
};

async function resolveReleaseAssetManifestForHTML(
  options: OptionsWithReleaseAssetManifest | undefined,
): Promise<ReleaseAssetManifest | null> {
  if (options?.studioEmbed) return null;
  if (options?.releaseAssetManifest !== undefined) return options.releaseAssetManifest;

  return await profilePhase(
    "html.release_asset_manifest",
    () => getReadyManifestForRenderAsync(resolveReleaseId(options)),
  );
}

/**
 * Locate the opening `<html>` tag in `html`, respecting quoted attribute values
 * so that a `>` inside an attribute value (e.g. `data-foo="a>b"`) does not
 * truncate the tag prematurely.
 *
 * Returns the start index, the exclusive end index (points past the `>`), and
 * the raw attribute string between `<html` and `>`. Returns null if no tag is
 * found or the tag is not properly closed.
 */
function findHtmlOpeningTag(
  html: string,
): { tagStart: number; tagEnd: number; attrs: string } | null {
  const lower = html.toLowerCase();
  const tagStart = lower.indexOf("<html");
  if (tagStart === -1) return null;

  const afterHtml = tagStart + 5;
  // Must be followed by whitespace, >, or / to be a genuine <html> element
  const boundary = lower[afterHtml];
  if (boundary && !/[\s>\/]/.test(boundary)) return null;

  let activeQuote: string | null = null;
  for (let i = afterHtml; i < html.length; i++) {
    const ch = html[i];
    if (activeQuote) {
      if (ch === activeQuote) activeQuote = null;
    } else if (ch === '"' || ch === "'") {
      activeQuote = ch;
    } else if (ch === ">") {
      return { tagStart, tagEnd: i + 1, attrs: html.slice(afterHtml, i) };
    }
  }
  return null; // unclosed tag
}

function applyExplicitThemeToDocument(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
): string {
  if (!enabled || !colorScheme) return html;

  const tag = findHtmlOpeningTag(html);
  if (!tag) return html;

  let nextAttrs = tag.attrs;

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

  return html.slice(0, tag.tagStart) + `<html${nextAttrs}>` + html.slice(tag.tagEnd);
}

function injectThemePersistenceScript(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
  nonce?: string,
): string {
  if (!enabled || !colorScheme || !/<\/head>/i.test(html)) return html;
  if (html.includes(`localStorage.setItem('theme','${colorScheme}')`)) return html;

  const nonceAttr = buildNonceAttribute(nonce);
  const script = `<script${nonceAttr}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){/* SILENT: localStorage may be unavailable */}})();
</script>`;

  return html.replace(/<\/head>/i, `${script}\n</head>`);
}

export class HTMLGenerator {
  private config: HTMLGeneratorConfig;

  constructor(config: HTMLGeneratorConfig) {
    this.config = config;
  }

  async generateFullHTML(context: HTMLGenerationContext): Promise<string> {
    let html: string;
    if (isFullHTMLDocument(context.html)) {
      let projectCSSPromise: Promise<ProjectCSSResult> | undefined;
      if (this.config.mode === "production" && context.options?.environment === "production") {
        const mergedFrontmatter = mergeCollectedFrontmatter(context);
        const htmlOptions = await profilePhase(
          "html.build_options",
          () => this.buildHTMLOptions(context, mergedFrontmatter),
        );
        projectCSSPromise = startProjectCSSPreparation(context, htmlOptions);
      }

      html = await this.handleFullHTMLDocument(context, projectCSSPromise);
    } else {
      html = await this.wrapHTMLFragment(context);
    }
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
    const mergedFrontmatter = mergeCollectedFrontmatter(fullContext);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(fullContext, mergedFrontmatter),
    );
    const projectCSSPromise = startProjectCSSPreparation(fullContext, htmlOptions);
    startPreparedCSSWarmup(this.config, fullContext, htmlOptions);

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
        await this.handleFullHTMLDocument(
          {
            ...fullContext,
            html: reactContent,
          },
          projectCSSPromise,
        ),
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

  private async handleFullHTMLDocument(
    context: HTMLGenerationContext,
    projectCSSPromise?: Promise<ProjectCSSResult>,
  ): Promise<string> {
    const metadata = extractHTMLMetadata(
      (context.pageInfo.entity.frontmatter || {}) as MDXFrontmatter,
      (context.layoutBundle?.frontmatter || {}) as MDXFrontmatter,
    );

    const pagePath = context.pageInfo.entity.path;
    const [isClientPage, releaseAssetManifest] = await Promise.all([
      this.detectUseClientDirective(pagePath),
      resolveReleaseAssetManifestForHTML(context.options),
    ]);
    const importMapJson = await buildImportMapJson({
      projectDir: this.config.projectDir,
      config: this.config.config,
      releaseAssetManifest,
    });

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

    const projectStylesheetHref = await this.resolveProjectStylesheetHref(
      context,
      projectCSSPromise,
    );

    const injectedHtml = injectHTMLContent(themedHtml, "", metadata, {
      mode: this.config.mode,
      slug: context.slug,
      devPort: this.config.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      pagePath,
      projectDir: this.config.projectDir,
      isClientPage,
      params: context.options?.params,
      environment: context.options?.environment,
      isLocalProject: this.config.isLocalProject === true,
      nonce: context.options?.nonce,
      importMapJson,
      projectStylesheetHref,
    });

    if (injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")) return injectedHtml;

    return `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async resolveProjectStylesheetHref(
    context: HTMLGenerationContext,
    projectCSSPromise?: Promise<ProjectCSSResult>,
  ): Promise<string | undefined> {
    if (!projectCSSPromise) return undefined;

    const projectCSS = await profilePhase("html.project_css", () => projectCSSPromise);
    const cssHash = projectCSS?.hash ?? "";
    if (cssHash) return `/_vf/css/${cssHash}.css`;

    logger.error("Project CSS hash is empty for full-document HTML", {
      slug: context.slug,
      environment: context.options?.environment,
    });
    return undefined;
  }

  private async detectUseClientDirective(pagePath: string): Promise<boolean> {
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      const isClientPage = hasUseClientDirective(pageContent, pagePath);

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
    const mergedFrontmatter = mergeCollectedFrontmatter(context);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(context, mergedFrontmatter),
    );
    const projectCSSPromise = startProjectCSSPreparation(context, htmlOptions);
    startPreparedCSSWarmup(this.config, context, htmlOptions);
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

    const { scripts, other } = buildCollectedHeadElements(head);
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
    const clientLayoutPaths = new Set(
      context.options?.clientPageIsland?.clientLayoutPaths ?? [],
    );
    const hydrationLayouts = context.options?.clientPageIsland
      ? context.nestedLayouts.filter((layout) =>
        clientLayoutPaths.has(layout.componentPath ?? layout.path ?? "")
      )
      : context.nestedLayouts;
    const hydrationLayoutPaths = new Set(
      hydrationLayouts.map((layout) =>
        extractRelativePath(
          layout.componentPath ?? layout.path ?? "",
          this.config.projectDir,
        )
      ),
    );
    const hydrationLayoutProps = context.options?.layoutProps
      ? Object.fromEntries(
        Object.entries(context.options.layoutProps).filter(([path]) =>
          hydrationLayoutPaths.has(path)
        ),
      )
      : undefined;
    const projectClasses = await profilePhase(
      "html.route_candidates",
      () => extractProjectClassesForRoute(this.config, context, appComponentPath),
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
      nestedLayouts: hydrationLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      appPath: context.options?.clientPageIsland ? undefined : appComponentPath,
      isolatedClientPage: context.options?.clientPageIsland ? true : undefined,
      layoutProps: hydrationLayoutProps,
      pagePath,
      pageType,
      nonce: context.options?.nonce,
      globalCSS: combinedCSS,
      frontmatter: mergedFrontmatter,
      studioEmbed: context.options?.studioEmbed,
      projectId: context.options?.projectId,
      projectSlug: context.options?.projectSlug,
      releaseId: resolveReleaseId(context.options),
      pageId: context.options?.pageId,
      sourceHash,
      colorScheme: context.options?.colorScheme,
      colorSchemeFromParam: context.options?.colorSchemeFromParam,
      colorSchemeFromHeader: context.options?.colorSchemeFromHeader,
      environment: context.options?.environment,
      headings: context.pageBundle.headings,
      projectClasses,
      isLocalProject: this.config.isLocalProject === true,
      noHmr: context.options?.noHmr,
      forceProductionScripts: context.options?.forceProductionScripts,
      ...(context.options?.releaseAssetManifest !== undefined
        ? { releaseAssetManifest: context.options.releaseAssetManifest }
        : {}),
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
    return mergeImportedProjectCss({
      fs: this.config.adapter.fs,
      logger,
      projectDir: this.config.projectDir,
      globalCSS,
      cssImports,
      stylesheetPath,
    });
  }
}
