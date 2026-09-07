import { dirname, join } from "#veryfront/compat/path";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  buildImportMapJson,
  buildStructuredManagedHeadDescriptors,
  escapeHTML,
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
} from "#veryfront/html";
import { buildNonceAttribute } from "#veryfront/html/html-escape.ts";
import {
  HEAD_PROVENANCE_ATTRIBUTE,
  HEAD_SHELL_PROVENANCE_ATTRIBUTE,
  headMetaSingletonKeyFromRecord,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";
import type { MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";
import type { RenderMetadata } from "#veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { hasUseClientDirective } from "#veryfront/rendering/rsc/page-island.ts";
import type { RenderEnvironment } from "#veryfront/rendering/context/render-context.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { profilePhase, profileSyncPhase } from "#veryfront/observability";
import { NOT_SUPPORTED } from "#veryfront/errors";
import {
  hasImmutableReleaseHydrationRuntime,
  resolveProdHydrationModulePath,
} from "#veryfront/html/hydration-script-builder/prod-runtime-selection.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { StreamTimeoutError, streamToString } from "../utils/stream-utils.ts";
import {
  extractProjectClassesForRoute,
  type ProjectCSSResult,
  startPreparedCSSWarmup,
  startProjectCSSPreparation,
} from "./html-project-css.ts";
import {
  buildCollectedHeadDescriptors,
  buildHeadElements as buildCollectedHeadElements,
  mergeCollectedHeadWithShell,
  mergeFrontmatter as mergeCollectedFrontmatter,
  resolveCommittedHeadFromHTML,
} from "./html-head.ts";
import { mergeImportedCSS as mergeImportedProjectCss } from "./html-imported-css.ts";
import type { CSSImportReference } from "#veryfront/modules/react-loader/css-import-collector.ts";
import type { HTMLGenerationContext, HTMLGeneratorConfig } from "./html-types.ts";

export type { HTMLGenerationContext, HTMLGeneratorConfig } from "./html-types.ts";

const logger = rendererLogger.component("html-generator");

export function resolveRenderEnvironment(
  requestEnvironment?: RenderEnvironment,
  configuredEnvironment?: RenderEnvironment,
): RenderEnvironment {
  return requestEnvironment ?? configuredEnvironment ?? "production";
}

export function resolveErrorContentSourceEnvironment(
  isLocalProject: boolean,
  environment: RenderEnvironment,
  releaseId?: string,
): RenderEnvironment {
  if (!isLocalProject && environment === "production" && !releaseId) {
    return "preview";
  }
  return environment;
}

export function resolveErrorContentSourceParameters(
  isLocalProject: boolean,
  requestEnvironment: RenderEnvironment | undefined,
  configuredEnvironment: RenderEnvironment | undefined,
  options: { releaseId?: string; contentSourceId?: string } | undefined,
): {
  environment: RenderEnvironment;
  contentSourceEnvironment: RenderEnvironment;
  releaseId?: string;
} {
  const environment = resolveRenderEnvironment(requestEnvironment, configuredEnvironment);
  const releaseId = resolveReleaseId(options);
  return {
    environment,
    contentSourceEnvironment: resolveErrorContentSourceEnvironment(
      isLocalProject,
      environment,
      releaseId,
    ),
    releaseId,
  };
}

function hasCollectedHeadEntries(
  head: HTMLGenerationContext["collectedHead"],
): boolean {
  return head !== undefined && (
    head.title !== undefined ||
    head.description !== undefined ||
    head.metas.length > 0 ||
    head.links.length > 0 ||
    head.styles.length > 0 ||
    head.scripts.length > 0
  );
}

function toShellFrontmatter(
  frontmatter: MDXFrontmatter,
): NonNullable<RenderMetadata["frontmatter"]> {
  // The public RenderMetadata type still exposes the legacy scalar-only
  // frontmatter index, while the HTML pipeline supports structured meta/link/
  // script/style fields. This boundary narrows only the type view; the shell
  // immediately validates and snapshots every structured value before use.
  const record: Record<string, unknown> = frontmatter;
  return record as NonNullable<RenderMetadata["frontmatter"]>;
}

function injectHeadScriptsAfterImportMap(html: string, scripts: string): string {
  const headOpen = html.indexOf("<head>");
  const headClose = headOpen < 0 ? -1 : html.indexOf("</head>", headOpen);
  if (headOpen < 0 || headClose < 0) {
    throw new Error("Generated HTML shell is missing a complete head element");
  }

  const lower = html.toLowerCase();
  let cursor = headOpen + "<head>".length;
  while (cursor < headClose) {
    const scriptStart = lower.indexOf("<script", cursor);
    if (scriptStart < 0 || scriptStart >= headClose) break;
    const scriptOpenEnd = lower.indexOf(">", scriptStart + "<script".length);
    if (scriptOpenEnd < 0 || scriptOpenEnd >= headClose) break;
    const openingTag = lower.slice(scriptStart, scriptOpenEnd + 1);
    if (/\stype\s*=\s*["']importmap["']/.test(openingTag)) {
      const scriptClose = lower.indexOf("</script>", scriptOpenEnd + 1);
      if (scriptClose < 0 || scriptClose >= headClose) break;
      const insertionPoint = scriptClose + "</script>".length;
      return html.slice(0, insertionPoint) +
        `\n  ${scripts}` +
        html.slice(insertionPoint);
    }
    cursor = scriptOpenEnd + 1;
  }

  throw new Error("Generated HTML shell is missing its framework import map");
}

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
    // Configured preview must reach every HTML path. Omitted production keeps
    // legacy behavior; an explicit production request still enables project CSS.
    const environment = context.options?.environment ??
      (this.config.environment === "preview" ? "preview" : undefined);
    const resolvedContext = environment === undefined ? context : {
      ...context,
      options: { ...context.options, environment },
    };
    const committedHead = resolveCommittedHeadFromHTML(
      resolvedContext.html,
      resolvedContext.collectedHead,
    );
    const effectiveContext = committedHead
      ? { ...resolvedContext, collectedHead: committedHead }
      : resolvedContext;
    let html: string;
    if (isFullHTMLDocument(effectiveContext.html)) {
      html = await this.handleFullHTMLDocument(effectiveContext);
    } else {
      html = await this.wrapHTMLFragment(effectiveContext);
    }
    const finalHtml = effectiveContext.options?.studioEmbed ? injectElementSelectors(html) : html;

    if (effectiveContext.options?.studioEmbed) {
      logger.debug("Injected element selectors for Studio");
    }

    return finalHtml;
  }

  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    let reactContent: string;
    try {
      reactContent = (await streamToString(reactStream)).trim();
    } catch (error) {
      if (!(error instanceof StreamTimeoutError)) throw error;

      logger.warn("Stream timed out; discarding partial content", {
        partialLength: error.partialContent.length,
      });
      throw error;
    }

    const committedHead = resolveCommittedHeadFromHTML(reactContent, context.collectedHead);
    // Match generateFullHTML: inherit only the positive preview signal.
    const environment = context.options?.environment ??
      (this.config.environment === "preview" ? "preview" : undefined);
    const fullContext = {
      ...context,
      ...(environment === undefined ? {} : { options: { ...context.options, environment } }),
      html: reactContent,
      ...(committedHead ? { collectedHead: committedHead } : {}),
    } as HTMLGenerationContext;

    if (isFullHTMLDocument(reactContent)) {
      const encoder = new TextEncoder();
      const fullHtml = await this.handleFullHTMLDocument({
        ...fullContext,
      });

      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(fullHtml));
          controller.close();
        },
      });
    }

    const mergedFrontmatter = mergeCollectedFrontmatter(fullContext);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(fullContext, mergedFrontmatter, true),
    );
    const projectCSSPromise = startProjectCSSPreparation(fullContext, htmlOptions);
    startPreparedCSSWarmup(this.config, fullContext, htmlOptions);

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
    const fullHtml = `${start}${reactContent}${end}`;

    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(fullHtml));
        controller.close();
      },
    });
  }

  private async handleFullHTMLDocument(
    context: HTMLGenerationContext,
  ): Promise<string> {
    if (hasCollectedHeadEntries(context.collectedHead)) {
      throw NOT_SUPPORTED.create({
        detail:
          "React <Head> cannot be combined with a component-authored full HTML document; declare that document head directly",
      });
    }
    const mergedFrontmatter = mergeCollectedFrontmatter(context);
    const hasReleaseIdentity = hasImmutableReleaseHydrationRuntime(
      resolveReleaseId(context.options),
    );
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(context, mergedFrontmatter, hasReleaseIdentity),
    );
    const projectCSSPromise = startProjectCSSPreparation(context, htmlOptions);
    const metadata = extractHTMLMetadata(
      mergedFrontmatter,
      (context.layoutBundle?.frontmatter || {}) as MDXFrontmatter,
    );
    // Full-document placeholders use the same bounded structured-head contract
    // as framework shells even though their authored placement is custom.
    buildStructuredManagedHeadDescriptors(metadata, metadata.title ?? "Veryfront App");

    const pagePath = context.pageInfo.entity.path;
    const [isClientPage, releaseAssetManifest] = await Promise.all([
      this.detectUseClientDirective(pagePath),
      resolveReleaseAssetManifestForHTML(context.options),
    ]);
    const importMapJson = await buildImportMapJson({
      projectDir: this.config.projectDir,
      config: this.config.config,
      moduleServerOrigin: context.options?.url?.origin,
      dependencyPinningCacheKey: context.options?.dependencyPinningCacheKey,
      dependencyPinningDependencies: context.options?.dependencyPinningDependencies,
      dependencyPinningSource: context.options?.dependencyPinningSource,
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
      dependencyPinningCacheKey: context.options?.dependencyPinningCacheKey,
      releaseAssetManifest,
      prodHydrationModulePath: htmlOptions.prodHydrationModulePath,
      directories: this.config.config.directories,
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
      () => this.buildHTMLOptions(context, mergedFrontmatter, true),
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
    const layoutFrontmatter = (context.layoutBundle?.frontmatter ?? {}) as MDXFrontmatter;
    const {
      frontmatter: enrichedFrontmatter,
      emissionHead,
      marksViewport,
    } = mergeCollectedHeadWithShell(
      mergedFrontmatter,
      layoutFrontmatter,
      head,
    );

    const completeManagedHeadPayload = serializeManagedHeadPayload([
      ...buildStructuredManagedHeadDescriptors(
        extractHTMLMetadata(enrichedFrontmatter, layoutFrontmatter),
        enrichedFrontmatter.title || "Veryfront App",
      ),
      ...buildCollectedHeadDescriptors(emissionHead),
    ]);

    const { start, end } = await generateHTMLShellParts(
      {
        title: enrichedFrontmatter.title || "Veryfront App",
        description: enrichedFrontmatter.description || "",
        slug: context.slug,
        frontmatter: toShellFrontmatter(enrichedFrontmatter),
        layoutFrontmatter: toShellFrontmatter(layoutFrontmatter),
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
      reactContent,
      projectCSSPromise,
      { managedHeadPayload: completeManagedHeadPayload },
    );

    let modifiedStart = start;

    // The shell always emits its own title and viewport, while React Head must
    // retain exact text/attributes for deterministic client adoption. Replace
    // or remove only these fixed framework-generated shapes, then let the
    // collected-head serializer emit the authoritative marked metadata.
    if (head?.title !== undefined) {
      const shellTitleOpen = `<title ${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true">`;
      const titleStart = modifiedStart.indexOf(shellTitleOpen);
      const titleEnd = titleStart < 0
        ? -1
        : modifiedStart.indexOf("</title>", titleStart + shellTitleOpen.length);
      if (titleStart >= 0 && titleEnd >= 0) {
        modifiedStart = modifiedStart.slice(0, titleStart) +
          `<title ${HEAD_PROVENANCE_ATTRIBUTE}="true">${escapeHTML(head.title)}</title>` +
          modifiedStart.slice(titleEnd + "</title>".length);
      }
    }

    const headDescription = head?.description ??
      head?.metas.find((meta) => headMetaSingletonKeyFromRecord(meta) === "meta:description")
        ?.content;
    if (headDescription !== undefined && headDescription.length > 0) {
      modifiedStart = modifiedStart.replace(
        `<meta name="description" content="${
          escapeHTML(headDescription)
        }" ${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true">`,
        "",
      );
    }
    if (marksViewport) {
      const viewport = head?.metas.find((meta) =>
        headMetaSingletonKeyFromRecord(meta) === "meta:viewport"
      );
      modifiedStart = modifiedStart.replace(
        `<meta name="viewport" content="${
          escapeHTML(viewport?.content ?? "")
        }" ${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true">`,
        "",
      );
    }

    const { scripts, other } = buildCollectedHeadElements(
      emissionHead,
      context.options?.nonce,
    );
    if (!scripts && !other) return { start: modifiedStart, end };

    // The framework import map must precede every module script. Keep collected
    // scripts ahead of CSS while inserting them only after that map is closed.
    if (scripts) {
      modifiedStart = injectHeadScriptsAfterImportMap(modifiedStart, scripts);
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

  /**
   * Resolve + load the nearest app-router `error.tsx` for the route's segment and
   * build a ready-to-render element with the caught error. Returns the element
   * (for the SSR error render) and the boundary's absolute source path (embedded
   * as `errorPath` so the client hydration bundle wraps the same boundary and it
   * hydrates). Null when the project has no matching `error.tsx`.
   */
  async resolveErrorComponent(
    context: HTMLGenerationContext,
    error: Error,
  ): Promise<{ element: unknown; path: string } | null> {
    const loaded = await this.resolveErrorComponentPath(context);
    if (!loaded) return null;

    try {
      const reactVersion = await resolveProjectReactVersion({
        projectDir: this.config.projectDir,
        config: this.config.config,
        dependencyPinningCacheKey: context.options?.dependencyPinningCacheKey,
        dependencyPinningDependencies: context.options?.dependencyPinningDependencies,
        dependencyPinningSource: context.options?.dependencyPinningSource,
      });
      const { getProjectReact } = await import(
        "#veryfront/react/compat/ssr-adapter/index.ts"
      );
      const React = await getProjectReact(reactVersion, this.config.adapter);
      const createElement = React.createElement as (
        component: unknown,
        props: unknown,
      ) => unknown;
      const element = createElement(loaded.component, { error, reset: () => {} });
      return { element, path: loaded.path };
    } catch (_) {
      return null;
    }
  }

  async resolveErrorComponentPath(
    context: HTMLGenerationContext,
  ): Promise<{ component: unknown; path: string } | null> {
    try {
      const appRoot = join(
        this.config.projectDir,
        this.config.config?.directories?.app ?? "app",
      );
      try {
        const st = await this.config.adapter.fs.stat(appRoot);
        if (!st.isDirectory) return null;
      } catch (_) {
        return null; // no app directory
      }

      const { collectAncestorDirs, loadReservedWithPath } = await import(
        "../app-reserved.ts"
      );
      const matchedPath = context.pageInfo?.entity?.path;
      const absolutePagePath = matchedPath
        ? matchedPath.startsWith(this.config.projectDir)
          ? matchedPath
          : join(this.config.projectDir, matchedPath)
        : appRoot;
      const segmentDir = matchedPath ? dirname(absolutePagePath) : appRoot;
      const dirs = await collectAncestorDirs(segmentDir, appRoot);
      const reactVersion = await resolveProjectReactVersion({
        projectDir: this.config.projectDir,
        config: this.config.config,
        dependencyPinningCacheKey: context.options?.dependencyPinningCacheKey,
        dependencyPinningDependencies: context.options?.dependencyPinningDependencies,
        dependencyPinningSource: context.options?.dependencyPinningSource,
      });
      const { computeContentSourceId } = await import("#veryfront/cache/keys.ts");
      const { environment, contentSourceEnvironment, releaseId } =
        resolveErrorContentSourceParameters(
          this.config.isLocalProject === true,
          context.options?.environment,
          this.config.environment,
          context.options,
        );
      const contentSourceId = computeContentSourceId(
        this.config.isLocalProject === true,
        contentSourceEnvironment,
        null,
        releaseId,
      );
      // The loader always receives the resolved request environment. A
      // release-less hosted production render keeps the legacy preview content
      // identity only so content-source validation cannot hide its error
      // boundary; it does not enable preview instrumentation.
      const loaded = await loadReservedWithPath(
        dirs,
        "error",
        this.config.projectDir,
        { compileMode: this.config.mode, environment },
        this.config.adapter,
        context.options?.projectId,
        contentSourceId,
        reactVersion,
        context.options?.dependencyPinningCacheKey,
        context.options?.dependencyPinningDependencies,
        context.options?.dependencyPinningSource,
        context.options?.url?.origin,
        this.config.config?.build?.serverExternalPackages,
      );
      if (!loaded) return null;

      return { component: loaded.component, path: loaded.filePath };
    } catch (_) {
      return null; // error.tsx resolution is best-effort
    }
  }

  private async loadProjectFile(filename: string): Promise<string | undefined> {
    try {
      const filePath = join(this.config.projectDir, filename);
      const fs = this.config.adapter.fs as typeof this.config.adapter.fs & {
        readOptionalTextFile?: (path: string) => Promise<string>;
      };
      const content = fs.readOptionalTextFile
        ? await fs.readOptionalTextFile(filePath)
        : await fs.readFile(filePath);
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
    includeProdHydrationRuntime: boolean,
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
    const releaseId = resolveReleaseId(context.options);
    const usesProductionScripts = context.options?.forceProductionScripts === true ||
      !(this.config.isLocalProject === true || context.options?.environment === "preview");
    const prodHydrationModulePath = includeProdHydrationRuntime && usesProductionScripts
      ? await profilePhase(
        "html.release_hydration_runtime",
        () =>
          resolveProdHydrationModulePath({
            fs: this.config.adapter.fs,
            projectDir: this.config.projectDir,
            buildOutDir: this.config.config?.build?.outDir,
            releaseId,
          }),
      )
      : undefined;
    return profileSyncPhase("html.build_options.finalize", () => ({
      mode: this.config.mode,
      config: this.config.config,
      projectDir: this.config.projectDir,
      moduleServerOrigin: context.options?.url?.origin,
      nestedLayouts: hydrationLayouts.map((l) => ({
        kind: l.kind,
        path: l.path,
        componentPath: l.componentPath,
      })),
      appPath: context.options?.clientPageIsland ? undefined : appComponentPath,
      // Set on the SSR error path so the client hydration bundle wraps the page
      // in the same app-router error boundary that rendered error.tsx on the server.
      errorPath: context.options?.errorPath,
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
      releaseId,
      prodHydrationModulePath,
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
      dependencyPinningCacheKey: context.options?.dependencyPinningCacheKey,
      dependencyPinningDependencies: context.options?.dependencyPinningDependencies,
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
    cssImports: Array<string | CSSImportReference> | undefined,
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
