/**
 * Centralized server endpoints and paths registry
 *
 * All internal veryfront URLs should be defined here as the single source of truth.
 * This prevents hardcoding URLs across the codebase and makes refactoring easier.
 */
export { DEFAULT_PORT } from "../../config/defaults.js";
/** Default port for development dashboard (matches veryfront.config.ts default) */
export declare const DEFAULT_DASHBOARD_PORT = 3001;
/** Internal URL prefix for all veryfront endpoints */
export declare const INTERNAL_PREFIX: "/_veryfront";
/**
 * All internal veryfront URL path prefixes (directories)
 */
export declare const INTERNAL_PATH_PREFIXES: {
    /** React Server Components endpoints */
    readonly RSC: "/_veryfront/rsc/";
    /** File system access endpoints (base64 encoded paths) */
    readonly FS: "/_veryfront/fs/";
    /** Virtual module system */
    readonly MODULES: "/_veryfront/modules/";
    /** Generated page modules */
    readonly PAGES: "/_veryfront/pages/";
    /** Data JSON endpoints */
    readonly DATA: "/_veryfront/data/";
    /** Library modules (AI SDK, etc.) */
    readonly LIB: "/_veryfront/lib/";
    /** Chunk assets */
    readonly CHUNKS: "/_veryfront/chunks/";
    /** Client component modules */
    readonly CLIENT: "/_veryfront/client/";
};
/**
 * Specific internal endpoint URLs
 */
export declare const INTERNAL_ENDPOINTS: {
    readonly HMR_RUNTIME: "/_veryfront/hmr-runtime.js";
    readonly HMR: "/_veryfront/hmr.js";
    readonly HYDRATE: "/_veryfront/hydrate.js";
    readonly ERROR_OVERLAY: "/_veryfront/error-overlay.js";
    readonly DEV_LOADER: "/_veryfront/dev-loader.js";
    readonly CLIENT_LOG: "/_veryfront/log";
    readonly CLIENT_JS: "/_veryfront/client.js";
    readonly ROUTER_JS: "/_veryfront/router.js";
    readonly PREFETCH_JS: "/_veryfront/prefetch.js";
    readonly MANIFEST_JSON: "/_veryfront/manifest.json";
    readonly APP_JS: "/_veryfront/app.js";
    readonly RSC_CLIENT: "/_veryfront/rsc/client.js";
    readonly RSC_MANIFEST: "/_veryfront/rsc/manifest";
    readonly RSC_STREAM: "/_veryfront/rsc/stream";
    readonly RSC_PAYLOAD: "/_veryfront/rsc/payload";
    readonly RSC_RENDER: "/_veryfront/rsc/render";
    readonly RSC_PAGE: "/_veryfront/rsc/page";
    readonly RSC_MODULE: "/_veryfront/rsc/module";
    readonly RSC_DOM: "/_veryfront/rsc/dom.js";
    readonly RSC_HYDRATOR: "/_veryfront/rsc/hydrator.js";
    readonly RSC_HYDRATE_CLIENT: "/_veryfront/rsc/hydrate-client.js";
    readonly LIB_AI_REACT: "/_veryfront/lib/ai/react.js";
    readonly LIB_AI_COMPONENTS: "/_veryfront/lib/ai/components.js";
    readonly LIB_AI_PRIMITIVES: "/_veryfront/lib/ai/primitives.js";
};
/**
 * Build output directory paths (relative)
 */
export declare const BUILD_DIRS: {
    /** Main build output directory */
    readonly ROOT: "_veryfront";
    /** Chunks directory */
    readonly CHUNKS: "_veryfront/chunks";
    /** Data directory */
    readonly DATA: "_veryfront/data";
    /** Assets directory */
    readonly ASSETS: "_veryfront/assets";
};
/**
 * Local project directory paths (relative to project root)
 * These are .gitignore'd directories for caching and temporary files
 */
export declare const PROJECT_DIRS: {
    /** Base veryfront internal directory */
    readonly ROOT: ".veryfront";
    /** Cache directory for build artifacts, transforms, etc. */
    readonly CACHE: ".veryfront/cache";
    /** KV store directory */
    readonly KV: ".veryfront/kv";
    /** Log files directory */
    readonly LOGS: ".veryfront/logs";
    /** Temporary files directory */
    readonly TMP: ".veryfront/tmp";
};
/** Default cache directory path */
export declare const DEFAULT_CACHE_DIR: ".veryfront/cache";
/**
 * Helper to check if a pathname is an internal veryfront endpoint
 */
export declare function isInternalEndpoint(pathname: string): boolean;
/**
 * Helper to check if a pathname is a static asset (has extension or is internal)
 */
export declare function isStaticAsset(pathname: string): boolean;
/**
 * Normalize a chunk path to include the base prefix
 */
export declare function normalizeChunkPath(filename: string, basePath?: string): string;
export declare const DEV_SERVER_ENDPOINTS: {
    readonly HMR_RUNTIME: "/_veryfront/hmr-runtime.js";
    readonly ERROR_OVERLAY: "/_veryfront/error-overlay.js";
};
//# sourceMappingURL=server.d.ts.map