/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */

import { serverLogger as logger } from "#veryfront/utils";
import { dirname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontRenderer } from "#veryfront/rendering/orchestrator/ssr.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import { renderAppRouteToHTML } from "#veryfront/server/build-app-route-renderer.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import { loadClientStyles } from "./asset-generation.ts";
import { buildImportMap } from "#veryfront/html/utils.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  cacheCSSAsync,
  extractCandidatesFromFiles,
  generateTailwindCSS,
  hashCSS,
} from "#veryfront/html/styles-builder/index.ts";
import { DEFAULT_STYLESHEET } from "#veryfront/html/styles-builder/css-hash-cache.ts";
import { FRAMEWORK_CANDIDATES } from "#veryfront/server/handlers/dev/framework-candidates.generated.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { SSG_GENERATION_ERROR } from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { escapeInlineScriptContent } from "../../html/html-escape.ts";
import {
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
import {
  collectStaticRouteOutputPaths,
  getAppRouteOutputPath as getAppRouteOutputRelativePath,
  getPagesRouteOutputPath,
  resolveBuildOutputPath,
} from "./route-output-paths.ts";

/** Renderer output consumed by Pages Router static generation. */
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

/** Counts, bytes, and URL paths emitted by one static-generation pass. */
export interface SSGStats {
  pages: number;
  totalSize: number;
  ssgPaths: string[];
}

/** Shared runtime and output context for Pages and App Router generation. */
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
}

function getOutputPath(outputDir: string, slug: string): string {
  return resolveBuildOutputPath(
    outputDir,
    getPagesRouteOutputPath(slug),
    `Pages route ${slug}`,
  );
}

function getAppRouteOutputPath(outputDir: string, routePath: string): string {
  return resolveBuildOutputPath(
    outputDir,
    getAppRouteOutputRelativePath(routePath),
    `App route ${routePath}`,
  );
}

function defaultTraceStep<T>(_: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

function getByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function hasImportMapScript(html: string): boolean {
  return /<script\b[^>]*\btype=(["'])importmap\1/i.test(html);
}

function extractClientNavigationHtml(html: string): string {
  const rootOpen = html.match(/<div\b(?=[^>]*\bid=(["'])root\1)[^>]*>/i);
  if (!rootOpen || rootOpen.index === undefined) {
    throw new TypeError("Rendered page must contain the Veryfront root element");
  }

  const contentStart = rootOpen.index + rootOpen[0].length;
  const portalsStart = html.indexOf('<div id="veryfront-portals"></div>', contentStart);
  if (portalsStart === -1) {
    throw new TypeError("Rendered page must contain the Veryfront portals element");
  }

  const rootClose = html.lastIndexOf("</div>", portalsStart);
  if (rootClose < contentStart) {
    throw new TypeError("Rendered page has an unclosed Veryfront root element");
  }

  return html.slice(contentStart, rootClose);
}

const APP_ROUTE_STYLE_SOURCE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
const APP_ROUTE_STYLE_SKIP_DIRS = new Set([
  ".deno_cache",
  ".git",
  ".veryfront",
  "coverage",
  "dist",
  "node_modules",
]);
const MAX_APP_ROUTE_STYLE_SCAN_DEPTH = 64;
const MAX_APP_ROUTE_STYLE_SCAN_ENTRIES = MAX_STYLE_SOURCE_FILES * 4;

function isPathInside(baseDir: string, targetPath: string): boolean {
  const pathFromBase = relative(resolve(baseDir), resolve(targetPath));
  return pathFromBase !== "" && !isAbsolute(pathFromBase) &&
    pathFromBase.split(/[\\/]/)[0] !== "..";
}

async function readOptionalFile(
  adapter: RuntimeAdapter,
  path: string,
): Promise<string | undefined> {
  try {
    return await adapter.fs.readFile(path);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

async function collectAppRouteStyleSources(
  adapter: RuntimeAdapter,
  dir: string,
): Promise<Array<{ path: string; content?: string }>> {
  const discovered: Array<{ path: string; size: number }> = [];
  let discoveredBytes = 0;
  let scannedEntries = 0;

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > MAX_APP_ROUTE_STYLE_SCAN_DEPTH) {
      throw new TypeError("App Router style source directory depth exceeds the scan limit");
    }
    let entries: AsyncIterable<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
    }>;
    try {
      entries = adapter.fs.readDir(currentDir);
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }

    for await (const entry of entries) {
      scannedEntries++;
      if (scannedEntries > MAX_APP_ROUTE_STYLE_SCAN_ENTRIES) {
        throw new TypeError("App Router style source entries exceed the scan limit");
      }
      if (entry.isSymlink) continue;
      if (entry.isDirectory) {
        if (!APP_ROUTE_STYLE_SKIP_DIRS.has(entry.name)) {
          await walk(join(currentDir, entry.name), depth + 1);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!APP_ROUTE_STYLE_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      const path = join(currentDir, entry.name);
      const relativePath = relative(dir, path).replaceAll("\\", "/");
      if (utf8ByteLength(relativePath) > MAX_STYLE_SOURCE_PATH_BYTES) {
        throw new TypeError("App Router style source path exceeds the size limit");
      }
      if (discovered.length >= MAX_STYLE_SOURCE_FILES) {
        throw new TypeError("App Router style source file count exceeds the limit");
      }
      const info = adapter.fs.lstat ? await adapter.fs.lstat(path) : await adapter.fs.stat(path);
      if (!info.isFile || info.isSymlink) continue;
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw new TypeError("App Router style source has an invalid size");
      }
      if (info.size > MAX_STYLE_SOURCE_FILE_BYTES) {
        throw new TypeError("App Router style source exceeds the size limit");
      }
      if (discoveredBytes > MAX_TOTAL_STYLE_SOURCE_BYTES - info.size) {
        throw new TypeError("App Router style sources exceed the total size limit");
      }
      discoveredBytes += info.size;
      discovered.push({ path, size: info.size });
    }
  }

  await walk(dir, 0);
  discovered.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  const files: Array<{ path: string; content?: string }> = [];
  let materializedBytes = 0;
  for (const { path, size } of discovered) {
    const content = await readOptionalFile(adapter, path);
    if (content === undefined) continue;
    const actualSize = utf8ByteLength(content);
    if (actualSize > MAX_STYLE_SOURCE_FILE_BYTES) {
      throw new TypeError("App Router style source exceeds the size limit");
    }
    materializedBytes += Math.max(size, actualSize);
    if (materializedBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
      throw new TypeError("App Router style sources exceed the total size limit");
    }
    files.push({ path, content });
  }
  return files;
}

async function readProjectStylesheet(
  adapter: RuntimeAdapter,
  projectDir: string,
  configuredPath: string,
): Promise<string | undefined> {
  if (typeof configuredPath !== "string" || !configuredPath.trim()) {
    throw new TypeError("Tailwind stylesheet path must not be blank");
  }
  const stylesheetPath = resolve(projectDir, configuredPath);
  if (!isPathInside(projectDir, stylesheetPath)) {
    throw new TypeError("Tailwind stylesheet must stay inside projectDir");
  }

  let info;
  try {
    info = adapter.fs.lstat
      ? await adapter.fs.lstat(stylesheetPath)
      : await adapter.fs.stat(stylesheetPath);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
  if (!info.isFile || info.isSymlink) {
    throw new TypeError("Tailwind stylesheet must be a regular project file");
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw new TypeError("Tailwind stylesheet has an invalid size");
  }
  if (info.size > MAX_STYLESHEET_BYTES) {
    throw new TypeError("Tailwind stylesheet exceeds the size limit");
  }
  if (adapter.fs.realPath) {
    const [canonicalProjectDir, canonicalStylesheetPath] = await Promise.all([
      adapter.fs.realPath(projectDir),
      adapter.fs.realPath(stylesheetPath),
    ]);
    if (!isPathInside(canonicalProjectDir, canonicalStylesheetPath)) {
      throw new TypeError("Tailwind stylesheet resolves outside projectDir");
    }
  }

  const stylesheet = await adapter.fs.readFile(stylesheetPath);
  if (utf8ByteLength(stylesheet) > MAX_STYLESHEET_BYTES) {
    throw new TypeError("Tailwind stylesheet exceeds the size limit");
  }
  return stylesheet;
}

async function prepareAppRouteStylesheet(
  options: SSGOptions,
): Promise<string | undefined> {
  const stylesheet = await readProjectStylesheet(
    options.adapter,
    options.projectDir,
    options.config.tailwind?.stylesheet ?? "globals.css",
  );
  const sourceFiles = await collectAppRouteStyleSources(options.adapter, options.projectDir);
  const candidates = extractCandidatesFromFiles(sourceFiles, {
    projectDir: options.projectDir,
  });
  for (const candidate of FRAMEWORK_CANDIDATES) candidates.add(candidate);

  const generated = await generateTailwindCSS(stylesheet, candidates, {
    minify: true,
    environment: "production",
    buildMode: "production",
  });

  if (generated.error) {
    throw SSG_GENERATION_ERROR.create({
      detail: "Failed to generate App Router CSS",
      context: { error: generated.error },
    });
  }

  const hash = hashCSS(generated.css);
  if (!hash) {
    throw SSG_GENERATION_ERROR.create({ detail: "Failed to hash generated App Router CSS" });
  }

  if (!options.dryRun) {
    await cacheCSSAsync(generated.css, hash, {
      candidates,
      stylesheet: stylesheet ?? DEFAULT_STYLESHEET,
    });
    const cssPath = join(options.outputDir, "_vf/css", `${hash}.css`);
    await options.adapter.fs.mkdir(dirname(cssPath), { recursive: true });
    await options.adapter.fs.writeFile(cssPath, generated.css);
  }

  return `/_vf/css/${hash}.css`;
}

/** Render Pages Router routes and their client navigation data. */
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
  collectStaticRouteOutputPaths(routes, [], outputDir);

  for (const route of routes) {
    try {
      const result = await traceStep(
        `page:${route.slug}`,
        () =>
          renderer.renderPage(route.slug, {
            contentSourceId,
            releaseAssetManifest: options.releaseAssetManifest,
          }),
      );

      let enhancedHtml = result.html;
      assertCompleteHtmlDocument(enhancedHtml, route.path);

      if (enablePrefetch && chunkManifest) {
        const { generatePreloadLinks } = await import(
          "../../build/bundler/code-splitter/index.ts"
        );
        const preloadLinks = generatePreloadLinks(
          chunkManifest,
          route.path,
          "/_veryfront/chunks",
        );
        enhancedHtml = insertBeforeClosingTag(enhancedHtml, "head", preloadLinks);
      }

      if (!hasImportMapScript(enhancedHtml)) {
        const importMap = await buildImportMap({
          projectDir: options.projectDir,
          config: options.config,
          releaseAssetManifest: options.releaseAssetManifest,
        });
        enhancedHtml = insertBeforeClosingTag(
          enhancedHtml,
          "head",
          `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${escapeInlineScriptContent(importMap.json)}
  </script>

  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>`,
        );
      } else {
        enhancedHtml = insertBeforeClosingTag(
          enhancedHtml,
          "head",
          `
  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>`,
        );
      }

      enhancedHtml = insertBeforeClosingTag(
        enhancedHtml,
        "body",
        generateClientRuntime(route, result, baseUrl),
      );

      const outputPath = getOutputPath(outputDir, route.slug);
      await adapter.fs.mkdir(dirname(outputPath), { recursive: true });

      if (dryRun) {
        stats.pages++;
        stats.totalSize += getByteLength(enhancedHtml);
        stats.ssgPaths.push(route.path);
        logger.debug(`Built page: ${route.slug}`);
        continue;
      }

      await traceStep(`write:${route.slug}`, () => adapter.fs.writeFile(outputPath, enhancedHtml));

      const pageData = {
        slug: route.slug,
        path: route.path,
        frontmatter: result.frontmatter,
        headings: result.headings,
        html: extractClientNavigationHtml(enhancedHtml),
      };

      const dataPath = resolveBuildOutputPath(
        outputDir,
        join("_veryfront/data", `${route.slug}.json`),
        `Pages route data ${route.path}`,
      );
      await adapter.fs.mkdir(dirname(dataPath), { recursive: true });
      await traceStep(
        `data:${route.slug}`,
        () => adapter.fs.writeFile(dataPath, JSON.stringify(pageData)),
      );

      const moduleCode = result.pageModule?.code;
      if (moduleCode) {
        const modulePath = resolveBuildOutputPath(
          outputDir,
          join("_veryfront/pages", `${route.slug}.js`),
          `Pages route module ${route.path}`,
        );
        await adapter.fs.mkdir(dirname(modulePath), { recursive: true });
        await traceStep(`module:${route.slug}`, () => adapter.fs.writeFile(modulePath, moduleCode));
      }

      stats.pages++;
      stats.totalSize += getByteLength(enhancedHtml);
      stats.ssgPaths.push(route.path);
      logger.debug(`Built page: ${route.slug}`);
    } catch (error) {
      logger.error("Failed to build Pages Router route", { route: route.path });
      throw SSG_GENERATION_ERROR.create({
        detail: `Failed to build page ${route.path}`,
        cause: error,
        context: { route: route.path },
      });
    }
  }

  return stats;
}

/** Render App Router routes and their generated project stylesheet. */
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
  collectStaticRouteOutputPaths([], appRoutes, outputDir);

  logger.info("Building App Router static pages...");
  const stylesheetHref = await traceStep(
    "app:styles",
    () => prepareAppRouteStylesheet(options),
  );

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
      assertCompleteHtmlDocument(html, route.path);

      const outputPath = getAppRouteOutputPath(outputDir, route.path);

      if (!dryRun) {
        await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
        await traceStep(`write:${route.path}`, () => adapter.fs.writeFile(outputPath, html));
      }

      stats.ssgPaths.push(route.path);
      stats.pages++;
      stats.totalSize += getByteLength(html);
    } catch (error) {
      logger.error("Failed to build App Router route", { route: route.path });
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
  </script>`;
}

function assertCompleteHtmlDocument(html: string, routePath: string): void {
  for (const tag of ["head", "body"] as const) {
    if (!new RegExp(`</${tag}\\s*>`, "i").test(html)) {
      throw new TypeError(`Rendered route ${routePath} has no closing </${tag}> element`);
    }
  }
}

function insertBeforeClosingTag(html: string, tag: "head" | "body", content: string): string {
  if (!content) return html;
  return html.replace(new RegExp(`</${tag}\\s*>`, "i"), `${content}\n$&`);
}
