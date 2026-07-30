/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */

import { serverLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { VeryfrontRenderer } from "#veryfront/rendering/orchestrator/ssr.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import { resolveProjectSourcePath } from "#veryfront/build/bundler/project-module-resolver.ts";
import { renderAppRouteToHTML } from "#veryfront/server/build-app-route-renderer.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import { loadClientStyles } from "./asset-generation.ts";
import { buildImportMap } from "#veryfront/html/utils.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  acquireCSSGenerationSession,
  cacheCSSAsync,
  extractCandidatesFromFiles,
  generateCSS,
  hashCSS,
} from "#veryfront/html/styles-builder/index.ts";
import { FRAMEWORK_CANDIDATES } from "#veryfront/server/handlers/dev/framework-candidates.generated.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { createSecureFs } from "#veryfront/security";
import { COMPILATION_ERROR, SSG_GENERATION_ERROR } from "#veryfront/errors";
import { collectCSSCandidateSourceFiles } from "../../html/styles-builder/css-source-collector.ts";
import { getRouteOutputPath } from "./output-paths.ts";

export interface PageRenderResult {
  html: string;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ level: number; text: string; id: string }>;
  pageModule?: {
    slug: string;
    code: string;
    type: "mdx" | "component";
  };
  ssrHash?: string;
}

export interface SSGStats {
  pages: number;
  totalSize: number;
  ssgPaths: string[];
}

export interface SSGOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  outputDir: string;
  renderer: VeryfrontRenderer;
  config: VeryfrontConfig;
  enablePrefetch: boolean;
  chunkManifest: ChunkManifest | null;
  /** Content source identifier for cache isolation (defaults to "build-static" for static builds) */
  contentSourceId?: string;
  baseUrl?: string;
  dryRun?: boolean;
  traceStep?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** React version for import map generation */
  reactVersion?: string;
  releaseAssetManifest?: ReleaseAssetManifest | null;
  /** Build output trees that must not be scanned as CSS candidate source input. */
  ignoredSourceDirs?: string[];
}

function defaultTraceStep<T>(_: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function getByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function createStaticRouteContext(
  path: string,
  baseUrl: string,
): { staticDataOnly: true; url: URL } {
  // Static route paths are root-relative; baseUrl supplies only the URL origin.
  const url = new URL(path, baseUrl || "http://localhost");
  return {
    staticDataOnly: true,
    url,
  };
}

function hasImportMapScript(html: string): boolean {
  return /<script\b[^>]*\btype\s*=\s*(?:(["'])importmap\1|importmap(?=[\s>]))/i.test(html);
}

function injectBeforeClosingTag(
  html: string,
  tag: "head" | "body",
  content: string,
): string {
  const closingTag = tag === "head" ? /<\/head\s*>/i : /<\/body\s*>/i;
  const match = closingTag.exec(html);
  if (match?.index === undefined) {
    throw new TypeError(`Rendered HTML is missing a closing </${tag}> tag`);
  }
  return html.slice(0, match.index) + content + html.slice(match.index);
}

function extractClientNavigationHtml(html: string): string {
  const rootOpen = html.match(/<div\b(?=[^>]*\bid=(["'])root\1)[^>]*>/i);
  if (!rootOpen || rootOpen.index === undefined) return html;

  const contentStart = rootOpen.index + rootOpen[0].length;
  const portalsStart = html.indexOf('<div id="veryfront-portals"></div>', contentStart);
  if (portalsStart === -1) return html;

  const rootClose = html.lastIndexOf("</div>", portalsStart);
  if (rootClose < contentStart) return html;

  return html.slice(contentStart, rootClose);
}

async function readOptionalFile(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

async function prepareAppRouteStylesheet(
  options: SSGOptions,
): Promise<string | undefined> {
  const stylesheetPath = options.config.styles?.stylesheet ?? "globals.css";
  const resolvedStylesheetPath = resolveProjectSourcePath(
    stylesheetPath,
    options.projectDir,
    "CSS stylesheet",
  );
  const secureFs = createSecureFs({
    baseDir: options.projectDir,
    adapter: options.adapter,
    context: "build",
    validationOptions: {
      followSymlinks: false,
    },
  });
  const stylesheet = await readOptionalFile(
    (path) => secureFs.readFile(path),
    resolvedStylesheetPath,
  );
  const sourceFiles = await collectCSSCandidateSourceFiles({
    adapter: options.adapter,
    projectDir: options.projectDir,
    patterns: ["**/*"],
    ignoredDirs: options.ignoredSourceDirs,
  });
  const candidates = extractCandidatesFromFiles(sourceFiles, {
    projectDir: options.projectDir,
  });
  for (const candidate of FRAMEWORK_CANDIDATES) candidates.add(candidate);
  const cssPipeline = await acquireCSSGenerationSession(true);
  const resolvedStylesheet = stylesheet ?? cssPipeline.compilationSession.defaultStylesheet;

  const generated = await generateCSS(resolvedStylesheet, candidates, {
    minify: true,
    environment: "production",
    buildMode: "production",
    projectSlug: options.projectDir,
  }, { generationSession: cssPipeline });

  if (candidates.size > 0 && generated.css.trim().length === 0) {
    throw COMPILATION_ERROR.create({
      detail: "App Router CSS compilation returned empty CSS for non-empty candidates",
    });
  }

  const hash = hashCSS(generated.css);

  if (!options.dryRun) {
    const cssPath = join(options.outputDir, "_vf/css", `${hash}.css`);
    await options.adapter.fs.mkdir(dirname(cssPath), { recursive: true });
    await options.adapter.fs.writeFile(cssPath, generated.css);
    await cacheCSSAsync(generated.css, hash, {
      candidates,
      stylesheet: resolvedStylesheet,
    });
  }

  return `/_vf/css/${hash}.css`;
}

export async function buildPagesRoutes(
  routes: RouteInfo[],
  options: SSGOptions,
): Promise<SSGStats> {
  const {
    adapter,
    outputDir,
    renderer,
    enablePrefetch,
    chunkManifest,
    contentSourceId = "build-static",
    baseUrl = "",
    dryRun = false,
    traceStep = defaultTraceStep,
  } = options;

  const stats: SSGStats = { pages: 0, totalSize: 0, ssgPaths: [] };
  const clientStyles = loadClientStyles();

  for (const route of routes) {
    try {
      const staticRouteContext = createStaticRouteContext(route.path, baseUrl);
      const result = await traceStep(
        `page:${route.slug}`,
        () =>
          renderer.renderPage(route.slug, {
            contentSourceId,
            ...staticRouteContext,
            ...(route.params ? { params: route.params } : {}),
            releaseAssetManifest: options.releaseAssetManifest,
          }),
      );

      let enhancedHtml = result.html;

      if (enablePrefetch && chunkManifest) {
        const { generatePreloadLinks } = await import(
          "../../build/bundler/code-splitter/index.ts"
        );
        const preloadLinks = generatePreloadLinks(
          chunkManifest,
          route.templatePath ?? route.path,
          "/_veryfront/chunks",
        );
        enhancedHtml = injectBeforeClosingTag(enhancedHtml, "head", `${preloadLinks}\n`);
      }

      if (!hasImportMapScript(enhancedHtml)) {
        const importMap = await buildImportMap({
          projectDir: options.projectDir,
          config: options.config,
          releaseAssetManifest: options.releaseAssetManifest,
        });
        enhancedHtml = injectBeforeClosingTag(
          enhancedHtml,
          "head",
          `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${importMap.json}
  </script>

  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
`,
        );
      } else {
        enhancedHtml = injectBeforeClosingTag(
          enhancedHtml,
          "head",
          `
  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
`,
        );
      }

      enhancedHtml = injectBeforeClosingTag(
        enhancedHtml,
        "body",
        generateClientRuntime(route, result, baseUrl),
      );

      const outputPath = getRouteOutputPath(outputDir, route.path);

      if (dryRun) {
        stats.pages++;
        stats.totalSize += getByteLength(enhancedHtml);
        stats.ssgPaths.push(route.path);
        logger.debug(`Built page: ${route.slug}`);
        continue;
      }

      await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
      await traceStep(`write:${route.slug}`, () => adapter.fs.writeFile(outputPath, enhancedHtml));

      const pageData = {
        slug: route.slug,
        path: route.path,
        frontmatter: result.frontmatter,
        headings: result.headings,
        html: extractClientNavigationHtml(enhancedHtml),
      };

      const dataPath = join(outputDir, "_veryfront/data", `${route.slug}.json`);
      await adapter.fs.mkdir(dirname(dataPath), { recursive: true });
      await traceStep(
        `data:${route.slug}`,
        () => adapter.fs.writeFile(dataPath, JSON.stringify(pageData)),
      );

      const moduleCode = result.pageModule?.code;
      if (moduleCode) {
        const modulePath = join(outputDir, "_veryfront/pages", `${route.slug}.js`);
        await adapter.fs.mkdir(dirname(modulePath), { recursive: true });
        await traceStep(`module:${route.slug}`, () => adapter.fs.writeFile(modulePath, moduleCode));
      }

      stats.pages++;
      stats.totalSize += getByteLength(enhancedHtml);
      stats.ssgPaths.push(route.path);
      logger.debug(`Built page: ${route.slug}`);
    } catch (error) {
      logger.error(`Failed to build ${route.slug}:`, error);
      throw SSG_GENERATION_ERROR.create({
        detail: `Failed to build page ${route.path}`,
        cause: error,
        context: { route: route.path },
      });
    }
  }

  return stats;
}

export async function buildAppRoutes(
  appRoutes: AppRouteInfo[],
  options: SSGOptions,
): Promise<SSGStats> {
  const {
    adapter,
    projectDir,
    outputDir,
    contentSourceId = "build-static",
    dryRun = false,
    traceStep = defaultTraceStep,
    reactVersion,
  } = options;

  const stats: SSGStats = { pages: 0, totalSize: 0, ssgPaths: [] };
  if (appRoutes.length === 0) return stats;

  logger.debug("Building App Router static pages...");
  let stylesheetHref: string | undefined;
  try {
    stylesheetHref = await traceStep(
      "app:styles",
      () => prepareAppRouteStylesheet(options),
    );
  } catch (error) {
    logger.error("Failed to prepare App Router styles:", error);
    throw SSG_GENERATION_ERROR.create({
      detail: "Failed to prepare App Router styles",
      cause: error,
      context: { stage: "app-styles" },
    });
  }

  for (const route of appRoutes) {
    try {
      const html = await traceStep(`app:${route.path}`, () =>
        renderAppRouteToHTML({
          adapter,
          projectDir,
          routePath: route.path,
          pageFile: route.pageFile,
          contentSourceId,
          reactVersion,
          config: options.config,
          releaseAssetManifest: options.releaseAssetManifest,
          stylesheetHref,
          includePreviewStylesheet: false,
        }));

      const outputPath = getRouteOutputPath(outputDir, route.path);

      if (!dryRun) {
        await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
        await traceStep(`write:${route.path}`, () => adapter.fs.writeFile(outputPath, html));
      }

      stats.ssgPaths.push(route.path);
      stats.pages++;
      stats.totalSize += getByteLength(html);
    } catch (error) {
      logger.error(`Failed to build app route ${route.path}:`, error);
      throw SSG_GENERATION_ERROR.create({
        detail: `Failed to build app route ${route.path}`,
        cause: error,
        context: { route: route.path },
      });
    }
  }

  return stats;
}

/**
 * Generate client runtime script for a page
 *
 * Note: We intentionally exclude `html` from pageData because:
 * 1. The SSR content is already in the DOM
 * 2. Including the full HTML causes content duplication when hydration scripts parse it
 * 3. It significantly increases bundle size
 */
function generateClientRuntime(
  route: RouteInfo,
  result: PageRenderResult,
  _baseUrl: string,
): string {
  const pageData = {
    slug: route.slug,
    frontmatter: result.frontmatter,
    headings: result.headings,
  };

  return `
  <!-- Page data for hydration -->
  <script data-veryfront-page type="application/json">
    ${jsonForInlineScript(pageData)}
  </script>

  <!-- Client runtime bootstrap -->
  <script type="module">
    import { boot } from '/_veryfront/client.js';
    if (typeof boot === 'function') {
      boot({ slug: ${jsonForInlineScript(route.slug)} });
    }
  </script>
`;
}
