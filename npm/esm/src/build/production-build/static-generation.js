/**
 * Static Site Generation (SSG) for Build
 * Handles rendering pages to static HTML
 */
import { serverLogger as logger } from "../../utils/index.js";
import { dirname, join } from "../../platform/compat/path/index.js";
import { renderAppRouteToHTML } from "../../server/build-app-route-renderer.js";
import { loadClientStyles } from "./asset-generation.js";
import { generateImportMap } from "./client-runtime.js";
function getOutputPath(outputDir, slug) {
    if (slug === "index")
        return join(outputDir, "index.html");
    return join(outputDir, slug, "index.html");
}
function getAppRouteOutputPath(outputDir, routePath) {
    if (routePath === "/")
        return join(outputDir, "index.html");
    return join(outputDir, routePath.slice(1), "index.html");
}
function defaultTraceStep(_, fn) {
    return fn();
}
function getByteLength(text) {
    return new TextEncoder().encode(text).length;
}
export async function buildPagesRoutes(routes, options) {
    const { adapter, outputDir, renderer, enablePrefetch, chunkManifest, contentSourceId = "build-static", baseUrl = "", dryRun = false, traceStep = defaultTraceStep, } = options;
    const stats = { pages: 0, totalSize: 0, ssgPaths: [] };
    const clientStyles = loadClientStyles();
    for (const route of routes) {
        try {
            const result = await traceStep(`page:${route.slug}`, () => renderer.renderPage(route.slug, { contentSourceId }));
            let enhancedHtml = result.html;
            if (enablePrefetch && chunkManifest) {
                const { generatePreloadLinks } = await import("../bundler/code-splitter/index.js");
                const preloadLinks = generatePreloadLinks(chunkManifest, route.path, "/_veryfront/chunks");
                enhancedHtml = enhancedHtml.replace("</head>", `${preloadLinks}\n</head>`);
            }
            const importMap = await generateImportMap();
            enhancedHtml = enhancedHtml.replace("</head>", `
${importMap}

  <!-- Basic styles -->
  <style>
${clientStyles}
  </style>
</head>`);
            enhancedHtml = enhancedHtml.replace("</body>", generateClientRuntime(route, result, baseUrl));
            const outputPath = getOutputPath(outputDir, route.slug);
            await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
            if (!dryRun) {
                await traceStep(`write:${route.slug}`, () => adapter.fs.writeFile(outputPath, enhancedHtml));
            }
            stats.pages++;
            stats.totalSize += getByteLength(enhancedHtml);
            const pageData = {
                slug: route.slug,
                path: route.path,
                frontmatter: result.frontmatter,
                headings: result.headings,
                html: result.html,
            };
            if (!dryRun) {
                const dataPath = join(outputDir, "_veryfront/data", `${route.slug}.json`);
                await adapter.fs.mkdir(dirname(dataPath), { recursive: true });
                await traceStep(`data:${route.slug}`, () => adapter.fs.writeFile(dataPath, JSON.stringify(pageData)));
                const moduleCode = result.pageModule?.code;
                if (moduleCode) {
                    const modulePath = join(outputDir, "_veryfront/pages", `${route.slug}.js`);
                    await adapter.fs.mkdir(dirname(modulePath), { recursive: true });
                    await traceStep(`module:${route.slug}`, () => adapter.fs.writeFile(modulePath, moduleCode));
                }
            }
            logger.debug(`Built page: ${route.slug}`);
        }
        catch (error) {
            logger.error(`Failed to build ${route.slug}:`, error);
        }
    }
    return stats;
}
export async function buildAppRoutes(appRoutes, options) {
    const { adapter, projectDir, outputDir, contentSourceId = "build-static", dryRun = false, traceStep = defaultTraceStep, reactVersion, } = options;
    const stats = { pages: 0, totalSize: 0, ssgPaths: [] };
    if (appRoutes.length === 0)
        return stats;
    logger.info("Building App Router static pages...");
    for (const route of appRoutes) {
        try {
            const html = await traceStep(`app:${route.path}`, () => renderAppRouteToHTML({
                adapter,
                projectDir,
                routePath: route.path,
                pageFile: route.pageFile,
                contentSourceId,
                reactVersion,
            }));
            const outputPath = getAppRouteOutputPath(outputDir, route.path);
            if (!dryRun) {
                await adapter.fs.mkdir(dirname(outputPath), { recursive: true });
                await traceStep(`write:${route.path}`, () => adapter.fs.writeFile(outputPath, html));
            }
            stats.ssgPaths.push(route.path);
            stats.pages++;
            stats.totalSize += getByteLength(html);
        }
        catch (error) {
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
function generateClientRuntime(route, result, _baseUrl) {
    const pageData = {
        slug: route.slug,
        frontmatter: result.frontmatter,
        headings: result.headings,
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
