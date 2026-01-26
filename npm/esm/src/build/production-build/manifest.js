import { bundlerLogger } from "../../utils/index.js";
function isValidChunkManifest(manifest) {
    if (!manifest || typeof manifest !== "object")
        return false;
    const m = manifest;
    return (typeof m.version === "string" &&
        !!m.routes &&
        typeof m.routes === "object" &&
        !!m.chunks &&
        typeof m.chunks === "object" &&
        Array.isArray(m.shared));
}
export function generateManifest(options) {
    const { routes, appRoutes, stats, enableSplitting, enablePrefetch, enableCompression, chunkManifest, } = options;
    const validatedManifest = chunkManifest && isValidChunkManifest(chunkManifest)
        ? chunkManifest
        : null;
    if (chunkManifest && !validatedManifest) {
        bundlerLogger.warn("Invalid chunk manifest structure, chunks will be disabled");
    }
    const getChunksForRoute = (path) => {
        if (!enableSplitting || !validatedManifest)
            return [];
        return validatedManifest.routes[path]?.chunks ?? [];
    };
    return {
        version: "2.0.0",
        buildTime: new Date().toISOString(),
        features: {
            streaming: true,
            codeSplitting: enableSplitting,
            clientRouting: true,
            prefetching: enablePrefetch,
            compression: enableCompression,
        },
        routes: [
            ...routes.map((r) => ({
                path: r.path,
                slug: r.slug,
                chunks: getChunksForRoute(r.path),
            })),
            ...appRoutes.map((r) => ({
                path: r.path,
                slug: r.path === "/" ? "index" : r.path.slice(1),
                chunks: [],
            })),
        ],
        chunks: validatedManifest,
        stats: {
            pages: stats.pages,
            chunks: stats.chunks,
            assets: stats.assets,
            totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
        },
    };
}
export function generateRedirects() {
    return `
# SPA support - all routes go to index.html
/*    /index.html   200
`;
}
