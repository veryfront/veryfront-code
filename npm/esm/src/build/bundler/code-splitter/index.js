/**
 * Code splitter public API
 * @module code-splitter
 */
export { CodeSplitter } from "./splitter.js";
export { convertPathToName, createEntryPoints } from "./entry-points.js";
export { buildManifest, calculateFileHash, extractChunkName, extractEntryName, getChunkInfo, getPreloadHints, isCriticalImport, writeManifest, } from "./manifest-builder.js";
export { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.js";
export { createSplitterPlugin } from "./esbuild-plugin.js";
import { CodeSplitter } from "./splitter.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
export function createCodeSplitter(options) {
    return new CodeSplitter(options);
}
export async function loadChunkManifest(manifestPath) {
    const fs = createFileSystem();
    const content = await fs.readTextFile(manifestPath);
    try {
        return JSON.parse(content);
    }
    catch {
        throw new Error(`Failed to parse chunk manifest: ${manifestPath}`);
    }
}
export function getChunksForRoute(manifest, routePath) {
    const route = manifest.routes[routePath];
    if (!route)
        return [];
    return [...(route.css ?? []), route.entry, ...route.chunks];
}
export function generatePreloadLinks(manifest, routePath, baseUrl = "") {
    const route = manifest.routes[routePath];
    if (!route)
        return "";
    const prefix = baseUrl ? `${baseUrl}/` : "";
    const preloadLinks = (route.preload ?? []).map((chunk) => `<link rel="modulepreload" href="${prefix}${chunk}">`);
    const cssLinks = (route.css ?? []).map((css) => `<link rel="preload" as="style" href="${prefix}${css}">`);
    return [`<link rel="modulepreload" href="${prefix}${route.entry}">`, ...preloadLinks, ...cssLinks]
        .join("\n");
}
