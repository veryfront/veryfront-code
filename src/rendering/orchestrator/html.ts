import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type { HTMLGenerationOptions } from "#veryfront/html";
import {
  buildImportMapJson,
  extractHTMLMetadata,
  generateHTMLShellParts,
  injectHTMLContent,
  isFullHTMLDocument,
} from "#veryfront/html";
import {
  findActiveDocumentOpeningTag,
  insertAtDocumentHeadEnd,
} from "#veryfront/html/html-injection.ts";
import { buildNonceAttribute, escapeHTML } from "#veryfront/html/html-escape.ts";
import type { MDXFrontmatter } from "#veryfront/types";
import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import { computeSourceHash } from "#veryfront/studio/hash-utils.ts";
import { extractRelativePath } from "#veryfront/utils/route-path-utils.ts";
import { hasUseClientDirective } from "#veryfront/rendering/rsc/page-island.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { resolveAppComponentPath } from "../layouts/utils/app-resolver.ts";
import { streamToString } from "../utils/stream-utils.ts";
import { profilePhase, profileSyncPhase } from "#veryfront/observability";
import {
  extractProjectClassesForRoute,
  type ProjectCSSResult,
  startPreparedCSSWarmup,
  startProjectCSSPreparation,
} from "./html-project-css.ts";
import {
  buildHeadElements as buildCollectedHeadElements,
  mergeFrontmatter as mergeCollectedFrontmatter,
  resolveDocumentMetadata,
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

interface OpeningTagAttribute {
  end: number;
  name: string;
  quote: '"' | "'" | null;
  start: number;
  value: string | null;
}

interface ThemeAttributeScan {
  attributes: OpeningTagAttribute[];
  closingSlashIndex: number | null;
}

const MAX_THEME_ATTRIBUTE_OCCURRENCES = 1024;
const TRAILING_CHARACTER_REFERENCE_PREFIX = /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*)$/;

function isHTMLSpace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\f" ||
    value === "\r";
}

function isAttributeName(
  openingTag: string,
  start: number,
  end: number,
  expected: string,
): boolean {
  if (end - start !== expected.length) return false;
  for (let index = 0; index < expected.length; index++) {
    if (openingTag[start + index]?.toLowerCase() !== expected[index]) return false;
  }
  return true;
}

function readThemeAttributes(openingTag: string): ThemeAttributeScan {
  const attributes: OpeningTagAttribute[] = [];
  const tagEnd = openingTag.length - 1;
  let index = "<html".length;
  let closingSlashIndex: number | null = null;

  while (index < tagEnd) {
    while (index < tagEnd && isHTMLSpace(openingTag[index])) index++;
    if (index >= tagEnd) break;
    if (openingTag[index] === "/") {
      let afterSlash = index + 1;
      while (afterSlash < tagEnd && isHTMLSpace(openingTag[afterSlash])) afterSlash++;
      if (afterSlash === tagEnd) {
        closingSlashIndex = index;
        break;
      }
      index++;
      continue;
    }

    const start = index;
    while (
      index < tagEnd && !isHTMLSpace(openingTag[index]) &&
      openingTag[index] !== "/" && openingTag[index] !== ">" &&
      openingTag[index] !== "="
    ) {
      index++;
    }
    if (index === start) {
      index++;
      continue;
    }

    const nameEnd = index;
    const name = isAttributeName(openingTag, start, nameEnd, "data-theme")
      ? "data-theme"
      : isAttributeName(openingTag, start, nameEnd, "style")
      ? "style"
      : null;
    let valueStart: number | null = null;
    let valueEnd: number | null = null;
    let quote: '"' | "'" | null = null;
    let valueCursor = index;
    while (valueCursor < tagEnd && isHTMLSpace(openingTag[valueCursor])) valueCursor++;

    if (openingTag[valueCursor] === "=") {
      valueCursor++;
      while (valueCursor < tagEnd && isHTMLSpace(openingTag[valueCursor])) valueCursor++;

      const valueQuote = openingTag[valueCursor];
      if (valueQuote === '"' || valueQuote === "'") {
        quote = valueQuote;
        valueStart = ++valueCursor;
        while (valueCursor < tagEnd && openingTag[valueCursor] !== valueQuote) valueCursor++;
        valueEnd = valueCursor;
        if (openingTag[valueCursor] === valueQuote) valueCursor++;
      } else {
        valueStart = valueCursor;
        while (
          valueCursor < tagEnd && !isHTMLSpace(openingTag[valueCursor]) &&
          openingTag[valueCursor] !== ">"
        ) {
          valueCursor++;
        }
        valueEnd = valueCursor;
      }
      index = valueCursor;
    } else {
      index = nameEnd;
    }

    if (name) {
      if (attributes.length >= MAX_THEME_ATTRIBUTE_OCCURRENCES) {
        throw new RangeError("HTML opening tag contains too many theme attributes");
      }
      attributes.push({
        end: index,
        name,
        quote,
        start,
        value: valueStart === null || valueEnd === null
          ? null
          : openingTag.slice(valueStart, valueEnd),
      });
    }
  }

  return { attributes, closingSlashIndex };
}

function appendColorScheme(
  styleValue: string | null | undefined,
  colorScheme: "light" | "dark",
): string {
  const existing = styleValue ?? "";
  const trimmedEnd = existing.trimEnd();
  const declaration = `color-scheme: ${colorScheme} !important;`;
  if (!trimmedEnd) return `${existing}${declaration}`;
  const separator = trimmedEnd.endsWith(";")
    ? existing.length === trimmedEnd.length ? " " : ""
    : TRAILING_CHARACTER_REFERENCE_PREFIX.test(trimmedEnd)
    ? " ; "
    : "; ";
  return `${existing}${separator}${declaration}`;
}

function serializeStyleAttribute(
  attribute: OpeningTagAttribute | undefined,
  colorScheme: "light" | "dark",
): string {
  const value = appendColorScheme(attribute?.value, colorScheme);
  if (attribute?.quote) return `${attribute.quote}${value}${attribute.quote}`;

  const quote = value.includes('"') && !value.includes("'") ? "'" : '"';
  const escapedValue = quote === '"'
    ? value.replaceAll('"', "&quot;")
    : value.replaceAll("'", "&#39;");
  return `${quote}${escapedValue}${quote}`;
}

function rewriteThemeAttributes(
  openingTag: string,
  colorScheme: "light" | "dark",
): string {
  const { attributes, closingSlashIndex } = readThemeAttributes(openingTag);
  const styleAttribute = attributes.find((attribute) => attribute.name === "style");
  let cursor = 0;
  const preservedParts: string[] = [];

  for (const attribute of attributes) {
    preservedParts.push(openingTag.slice(cursor, attribute.start));
    cursor = attribute.end;
    while (cursor < openingTag.length - 1 && isHTMLSpace(openingTag[cursor])) cursor++;
  }
  preservedParts.push(openingTag.slice(cursor, -1));

  let prefix = preservedParts.join("").trimEnd();
  if (closingSlashIndex !== null && prefix.endsWith("/")) {
    prefix = prefix.slice(0, -1).trimEnd();
  }
  const serializedStyle = serializeStyleAttribute(styleAttribute, colorScheme);
  const closing = closingSlashIndex === null ? ">" : " />";
  return `${prefix} data-theme="${escapeHTML(colorScheme)}" style=${serializedStyle}${closing}`;
}

function applyExplicitThemeToDocument(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
): string {
  if (!enabled || !colorScheme) return html;

  const tag = findActiveDocumentOpeningTag(html, "html");
  if (!tag) return html;

  const openingTag = html.slice(tag.start, tag.end);
  return html.slice(0, tag.start) + rewriteThemeAttributes(openingTag, colorScheme) +
    html.slice(tag.end);
}

function injectThemePersistenceScript(
  html: string,
  colorScheme: "light" | "dark" | undefined,
  enabled: boolean | undefined,
  nonce?: string,
): string {
  if (!enabled || !colorScheme) return html;

  const nonceAttr = buildNonceAttribute(nonce);
  const script = `<script${nonceAttr}>
(function(){try{localStorage.setItem('theme','${colorScheme}')}catch(e){/* SILENT: localStorage may be unavailable */}})();
</script>`;

  return insertAtDocumentHeadEnd(html, `${script}\n`);
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
    return addNonceToHtmlTags(html, context.options?.nonce);
  }

  async generateHTMLStream(
    reactStream: ReadableStream,
    context: Omit<HTMLGenerationContext, "html">,
  ): Promise<ReadableStream> {
    const fullContext = context as HTMLGenerationContext;
    const reactContent = (await streamToString(reactStream)).trim();

    if (isFullHTMLDocument(reactContent)) {
      const encoder = new TextEncoder();
      const generatedHtml = await this.handleFullHTMLDocument({
        ...fullContext,
        html: reactContent,
      });
      const fullHtml = addNonceToHtmlTags(
        generatedHtml,
        context.options?.nonce,
      );

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
      () => this.buildHTMLOptions(fullContext, mergedFrontmatter),
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
    const generatedHtml = `${start}${reactContent}${end}`;
    const fullHtml = addNonceToHtmlTags(
      generatedHtml,
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
  ): Promise<string> {
    const mergedFrontmatter = mergeCollectedFrontmatter(context);
    const htmlOptions = await profilePhase(
      "html.build_options",
      () => this.buildHTMLOptions(context, mergedFrontmatter),
    );
    const projectCSSPromise = startProjectCSSPreparation(context, htmlOptions);
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

    const projectStylesheetHref = await this.resolveProjectStylesheetHref(projectCSSPromise);

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
      studioEmbed: context.options?.studioEmbed,
      projectId: htmlOptions.projectId,
      pageId: htmlOptions.pageId,
      sourceHash: htmlOptions.sourceHash,
      nonce: context.options?.nonce,
      importMapJson,
      projectStylesheetHref,
    });

    if (injectedHtml.trimStart().toLowerCase().startsWith("<!doctype")) return injectedHtml;

    return `<!DOCTYPE html>\n${injectedHtml}`;
  }

  private async resolveProjectStylesheetHref(
    projectCSSPromise?: Promise<ProjectCSSResult>,
  ): Promise<string | undefined> {
    if (!projectCSSPromise) return undefined;

    const projectCSS = await profilePhase("html.project_css", () => projectCSSPromise);
    const cssHash = projectCSS?.hash ?? "";
    if (cssHash) return `/_vf/css/${cssHash}.css`;

    logger.error("Project CSS hash is empty for full-document HTML");
    return undefined;
  }

  private async detectUseClientDirective(pagePath: string): Promise<boolean> {
    try {
      const pageContent = await this.config.adapter.fs.readFile(pagePath);
      const isClientPage = hasUseClientDirective(pageContent, pagePath);

      if (isClientPage) {
        logger.debug("Detected a use-client page");
      }

      return isClientPage;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      logger.debug("Page file was not found during directive detection");
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
    const documentMetadata = resolveDocumentMetadata(mergedFrontmatter, head);

    const { start, end } = await generateHTMLShellParts(
      {
        title: documentMetadata.title,
        description: documentMetadata.description,
        slug: context.slug,
        frontmatter: documentMetadata.frontmatter,
        layoutFrontmatter: context.layoutBundle?.frontmatter,
        ssrHash: context.ssrHash,
      },
      htmlOptions,
      context.options?.params,
      context.options?.props,
      reactContent,
      projectCSSPromise,
    );

    const { scripts, moduleScripts, other } = buildCollectedHeadElements(head);
    if (!scripts && !moduleScripts && !other) return { start, end };

    let modifiedStart = start;

    // Inject blocking scripts at TOP of <head> (after opening tag, before meta/CSS)
    if (scripts) {
      modifiedStart = modifiedStart.replace("<head>", `<head>\n  ${scripts}`);
    }

    // Module scripts must follow the import map. Other collected head elements
    // also stay at the bottom of the generated head.
    const trailingHeadElements = [moduleScripts, other].filter(Boolean).join("\n  ");
    if (trailingHeadElements) {
      modifiedStart = insertAtDocumentHeadEnd(
        modifiedStart,
        `  ${trailingHeadElements}\n`,
      );
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
    if (!filename || filename.includes("\0") || filename.includes("\\") || isAbsolute(filename)) {
      throw new TypeError("Configured project file path must be project-relative");
    }
    const filePath = normalize(join(this.config.projectDir, filename));
    if (!isPathWithinRoot(filePath, this.config.projectDir)) {
      throw new TypeError("Configured project file path must stay inside the project");
    }

    try {
      const fs = this.config.adapter.fs as typeof this.config.adapter.fs & {
        readOptionalTextFile?: (path: string) => Promise<string>;
      };
      if (fs.lstat) {
        const info = await fs.lstat(filePath);
        if (!info.isFile || info.isSymlink) {
          throw new TypeError("Configured project file must be a regular file");
        }
      }
      if (fs.realPath) {
        const [canonicalPath, canonicalRoot] = await Promise.all([
          fs.realPath(filePath),
          fs.realPath(this.config.projectDir),
        ]);
        if (!isPathWithinRoot(canonicalPath, canonicalRoot)) {
          throw new TypeError("Configured project file path must stay inside the project");
        }
      }
      const content = fs.readOptionalTextFile
        ? await fs.readOptionalTextFile(filePath)
        : await fs.readFile(filePath);
      if (new TextEncoder().encode(content).byteLength > 10 * 1024 * 1024) {
        throw new RangeError("Configured project file exceeds the size limit");
      }
      logger.debug("Loaded optional project file", { length: content.length });
      return content;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      logger.debug("Optional project file was not found");
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
      found: appComponentPath !== undefined,
      hasConfig: !!this.config.config,
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

    const sourceHash = context.options?.studioEmbed &&
        context.pageInfo.entity.content !== undefined
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

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
