/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */

import { serverLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/compat/path/index.ts";
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
}

function getOutputPath(outputDir: string, slug: string): string {
  if (slug === "index") return join(outputDir, "index.html");
  return join(outputDir, slug, "index.html");
}

function getAppRouteOutputPath(outputDir: string, routePath: string): string {
  if (routePath === "/") return join(outputDir, "index.html");
  return join(outputDir, routePath.slice(1), "index.html");
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
  if (!rootOpen || rootOpen.index === undefined) return html;

  const contentStart = rootOpen.index + rootOpen[0].length;
  const portalsStart = html.indexOf('<div id="veryfront-portals"></div>', contentStart);
  if (portalsStart === -1) return html;

  const rootClose = html.lastIndexOf("</div>", portalsStart);
  if (rootClose < contentStart) return html;

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

async function readOptionalFile(
  adapter: RuntimeAdapter,
  path: string,
): Promise<string | undefined> {
  try {
    return await adapter.fs.readFile(path);
  } catch (_) {
    return undefined;
  }
}

async function collectAppRouteStyleSources(
  adapter: RuntimeAdapter,
  dir: string,
): Promise<Array<{ path: string; content?: string }>> {
  const files: Array<{ path: string; content?: string }> = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
    try {
      entries = adapter.fs.readDir(currentDir);
    } catch (_) {
      return;
    }

    for await (const entry of entries) {
      if (entry.isDirectory) {
        if (!APP_ROUTE_STYLE_SKIP_DIRS.has(entry.name)) {
          await walk(join(currentDir, entry.name));
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!APP_ROUTE_STYLE_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      const path = join(currentDir, entry.name);
      const content = await readOptionalFile(adapter, path);
      if (content !== undefined) files.push({ path, content });
    }
  }

  await walk(dir);
  return files;
}

async function prepareAppRouteStylesheet(
  options: SSGOptions,
): Promise<string | undefined> {
  const stylesheetPath = options.config.tailwind?.stylesheet ?? "globals.css";
  const stylesheet = await readOptionalFile(
    options.adapter,
    join(options.projectDir, stylesheetPath),
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
    logger.error("Failed to generate App Router CSS:", generated.error);
    return undefined;
  }

  const hash = hashCSS(generated.css);
  if (!hash) return undefined;

  await cacheCSSAsync(generated.css, hash, {
    candidates,
    stylesheet: stylesheet ?? DEFAULT_STYLESHEET,
  });

  if (!options.dryRun) {
    const cssPath = join(options.outputDir, "_vf/css", `${hash}.css`);
    await options.adapter.fs.mkdir(dirname(cssPath), { recursive: true });
    await options.adapter.fs.writeFile(cssPath, generated.css);
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
      const result = await traceStep(
        `page:${route.slug}`,
        () =>
          renderer.renderPage(route.slug, {
            contentSourceId,
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
          route.path,
          "/_veryfront/chunks",
        );
        enhancedHtml = enhancedHtml.replace("</head>", `${preloadLinks}\n</head>`);
      }

      if (!hasImportMapScript(enhancedHtml)) {
        const importMap = await buildImportMap({
          projectDir: options.projectDir,
          config: options.config,
          releaseAssetManifest: options.releaseAssetManifest,
        });
        enhancedHtml = enhancedHtml.replace(
          "</head>",
          `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${importMap.json}
  </script>

  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
</head>`,
        );
      } else {
        enhancedHtml = enhancedHtml.replace(
          "</head>",
          `
  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
</head>`,
        );
      }

      enhancedHtml = enhancedHtml.replace(
        "</body>",
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

      stats.pages++;
      stats.totalSize += getByteLength(enhancedHtml);
      stats.ssgPaths.push(route.path);

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

      logger.debug(`Built page: ${route.slug}`);
    } catch (error) {
      logger.error(`Failed to build ${route.slug}:`, error);
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
          releaseAssetManifest: options.releaseAssetManifest,
          stylesheetHref,
          includePreviewStylesheet: false,
        }));

      const outputPath = getAppRouteOutputPath(outputDir, route.path);

      if (!dryRun) {
        await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
        await traceStep(`write:${route.path}`, () => adapter.fs.writeFile(outputPath, html));
      }

      stats.ssgPaths.push(route.path);
      stats.pages++;
      stats.totalSize += getByteLength(html);
    } catch (error) {
      logger.error(`Failed to build app route ${route.path}:`, error);
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
</body>`;
}
