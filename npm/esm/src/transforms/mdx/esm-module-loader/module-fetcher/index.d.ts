import type { Logger } from "../../../../utils/logger/logger.js";
import type { RuntimeAdapter } from "../../../../platform/adapters/base.js";
import type { ModuleFetcherContext } from "../types.js";
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
}): ModuleFetcherContext;
//# sourceMappingURL=index.d.ts.map