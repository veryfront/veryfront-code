/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */

import { serverLogger as logger } from "@veryfront/utils";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontRenderer } from "../../rendering/orchestrator/ssr.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import type { ChunkManifest } from "../../build/bundler/index.ts";
import { renderAppRouteToHTML } from "../../server/build-app-route-renderer.ts";
import type { AppRouteInfo, RouteInfo } from "../../server/build-types.ts";
import { loadClientStyles } from "./asset-generation.ts";
import { generateImportMap } from "./client-runtime.ts";

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
  baseUrl?: string;
  dryRun?: boolean;
  traceStep?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

/**
 * Build all pages from Pages Router
 */
export async function buildPagesRoutes(
  routes: RouteInfo[],
  options: SSGOptions,
): Promise<SSGStats> {
  const {
    adapter,
    projectDir: _projectDir,
    outputDir,
    renderer,
    config: _config,
    enablePrefetch,
    chunkManifest,
    baseUrl = "",
    dryRun = false,
    traceStep = async <T>(_: string, fn: () => Promise<T>) => await fn(),
  } = options;

  const stats: SSGStats = {
    pages: 0,
    totalSize: 0,
    ssgPaths: [],
  };

  // Load client styles once (embedded, no I/O)
  const clientStyles = loadClientStyles();

  for (const route of routes) {
    try {
      // Render page
      const result = (await traceStep(`page:${route.slug}`, () =>
        renderer.renderPage(route.slug))) as PageRenderResult;

      // Inject advanced features into HTML
      let enhancedHtml = result.html;

      // Add preload hints
      if (enablePrefetch && chunkManifest) {
        const { generatePreloadLinks } = await import("../../build/bundler/code-splitter/index.ts");
        const preloadLinks = generatePreloadLinks(chunkManifest, route.path, "/_veryfront/chunks");
        enhancedHtml = enhancedHtml.replace("</head>", `${preloadLinks}\n</head>`);
      }

      // Add import map and styles
      const importMap = await generateImportMap();
      enhancedHtml = enhancedHtml.replace(
        "</head>",
        `
${importMap}

  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
</head>`,
      );

      // Add client-side runtime
      enhancedHtml = enhancedHtml.replace("</body>", generateClientRuntime(route, result, baseUrl));

      // Determine output path
      const outputPath = route.slug === "index"
        ? join(outputDir, "index.html")
        : join(outputDir, route.slug, "index.html");

      // Ensure directory exists
      await mkdir(dirname(outputPath), { recursive: true });

      // Write HTML
      if (!dryRun) {
        await traceStep(`write:${route.slug}`, () =>
          adapter.fs.writeFile(outputPath, enhancedHtml));
      }

      // Note: Pages Router paths are NOT added to ssgPaths (only App Router paths are)
      // This is intentional per SSG design - ssgPaths only tracks App Router static paths
      stats.pages++;
      stats.totalSize += new TextEncoder().encode(enhancedHtml).length;

      // Generate page data for client-side navigation
      const pageData = {
        slug: route.slug,
        path: route.path,
        frontmatter: result.frontmatter,
        headings: result.headings,
        html: result.html, // Include rendered HTML for client navigation
      };

      if (!dryRun) {
        const dataPath = join(outputDir, "_veryfront/data", `${route.slug}.json`);
        await mkdir(dirname(dataPath), { recursive: true });
        await traceStep(`data:${route.slug}`, () =>
          adapter.fs.writeFile(dataPath, JSON.stringify(pageData)));

        if (result.pageModule?.code) {
          const modulePath = join(outputDir, "_veryfront/pages", `${route.slug}.js`);
          await mkdir(dirname(modulePath), { recursive: true });
          await traceStep(`module:${route.slug}`, () =>
            adapter.fs.writeFile(modulePath, result.pageModule!.code));
        }
      }

      logger.debug(`Built page: ${route.slug}`);
    } catch (error) {
      logger.error(`Failed to build ${route.slug}:`, error);
    }
  }

  return stats;
}

/**
 * Build App Router literal pages
 */
export async function buildAppRoutes(
  appRoutes: AppRouteInfo[],
  options: SSGOptions,
): Promise<SSGStats> {
  const {
    adapter,
    projectDir,
    outputDir,
    dryRun = false,
    traceStep = async <T>(_: string, fn: () => Promise<T>) => await fn(),
  } = options;

  const stats: SSGStats = {
    pages: 0,
    totalSize: 0,
    ssgPaths: [],
  };

  if (appRoutes.length === 0) {
    return stats;
  }

  logger.info("Building App Router static pages...");

  for (const route of appRoutes) {
    try {
      const html = await traceStep(`app:${route.path}`, () =>
        renderAppRouteToHTML({
          adapter,
          projectDir,
          routePath: route.path,
          pageFile: route.pageFile,
        }));

      const outputPath = route.path === "/"
        ? join(outputDir, "index.html")
        : join(outputDir, route.path.slice(1), "index.html");

      if (!dryRun) {
        await mkdir(dirname(outputPath), { recursive: true });
        await traceStep(`write:${route.path}`, () => adapter.fs.writeFile(outputPath, html));
      }

      stats.ssgPaths.push(route.path);
      stats.pages++;
      stats.totalSize += new TextEncoder().encode(html).length;
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
    // Note: html field is intentionally omitted to prevent content duplication
  };

  return `
  <!-- Page data for hydration -->
  <script data-veryfront-page type="application/json">
    ${JSON.stringify(pageData)}
  </script>

  <!-- Client runtime bootstrap -->
  <script type="module">
    import { boot } from '/_veryfront/client.js';
    if (typeof boot === 'function') {
      boot({ slug: '${route.slug}' });
    }
  </script>
</body>`;
}
