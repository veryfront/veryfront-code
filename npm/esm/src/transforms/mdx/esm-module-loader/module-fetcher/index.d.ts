import type { Logger } from "../../../../utils/logger/logger.js";
import type { RuntimeAdapter } from "../../../../platform/adapters/base.js";
import type { ModuleFetcherContext } from "../types.js";
/**
 * Error thrown when transform tree exceeds the timeout.
 */
export declare class TransformTreeTimeoutError extends Error {
    constructor(normalizedPath: string, elapsedMs: number);
}
/**
 * Rewrite relative imports in framework files to absolute file:// paths.
 *
 * Framework files from the npm package (e.g., Head.js) contain relative imports like:
 *   import "../../../_dnt.polyfills.js"
 *   import { collectHead } from "../head-collector.js"
 *
 * These resolve correctly when loaded from the npm package directory, but break when
 * the transformed code is cached to a different directory (e.g., /app/.cache/veryfront-mdx-esm/...).
 * The relative path would resolve to /app/.cache/head-collector.js which doesn't exist.
 *
 * Fix: Replace ALL relative imports with absolute file:// paths resolved from the source file's directory.
 */
export declare function rewriteDntImports(code: string, sourceFilePath: string): string;
/**
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export declare function startRenderSession(sessionId: string, projectSlug?: string, route?: string): void;
/**
 * End a render session and record loaded modules to the manifest.
 */
export declare function endRenderSession(sessionId: string): void;
/**
 * Fetch and cache a module.
 * This is the main entry point for module fetching operations.
 */
export declare function fetchAndCacheModule(modulePath: string, context: ModuleFetcherContext, parentModulePath?: string): Promise<string | null>;
/**
 * Create a module fetcher context.
 */
export declare function createModuleFetcherContext(esmCacheDir: string, adapter: RuntimeAdapter, projectDir: string, projectId: string, options?: {
    isLocalDev?: boolean;
    projectSlug?: string;
    reactVersion?: string;
    logger?: Logger;
    strictMissingModules?: boolean;
}): ModuleFetcherContext;
//# sourceMappingURL=index.d.ts.map