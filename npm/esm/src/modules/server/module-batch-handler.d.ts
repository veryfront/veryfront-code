/**
 * Module Batch Handler
 *
 * Coalesces multiple module requests into a single HTTP response.
 * This dramatically reduces HTTP overhead from 232 requests to ~5-10 batch requests.
 *
 * Endpoint: /_vf_modules/_batch
 *
 * Query params:
 * - paths: Comma-separated module paths (e.g., "pages/index.js,layouts/MainLayout.js")
 * - project: Project slug (optional, inferred from host)
 *
 * Response format:
 * A JavaScript module that re-exports all requested modules.
 *
 * @module module-system/server/module-batch-handler
 */
import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export interface BatchHandlerOptions {
    projectDir: string;
    adapter: RuntimeAdapter;
    projectSlug?: string;
    projectId?: string;
    branch?: string | null;
    dev?: boolean;
    /**
     * Restrict module imports to specific directories (opt-in security).
     * When not set, users can import from any directory in the project.
     */
    allowedImportDirs?: string[];
    /** React version for transforms (from project config) */
    reactVersion?: string;
}
/**
 * Handle a batch module request
 */
export declare function handleModuleBatch(req: dntShim.Request, options: BatchHandlerOptions): Promise<dntShim.Response>;
/**
 * Clear the transform cache (on deployment or memory pressure)
 */
export declare function clearBatchCache(projectSlug?: string): void;
/**
 * Get cache statistics
 */
export declare function getBatchCacheStats(): {
    size: number;
    keys: string[];
};
//# sourceMappingURL=module-batch-handler.d.ts.map