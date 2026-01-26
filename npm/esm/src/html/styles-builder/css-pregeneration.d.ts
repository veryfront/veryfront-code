/**
 * CSS Pre-generation Utility
 *
 * Triggers CSS generation early (after files are fetched) instead of waiting
 * until HTML shell generation during SSR. This runs in parallel with other
 * initialization work, reducing first-request latency by ~2-3 seconds.
 */
export interface CSSPregenerationOptions {
    /** Project slug for cache keying */
    projectSlug: string;
    /** List of files with content to extract candidates from */
    files: Array<{
        path: string;
        content?: string;
    }>;
    /** Optional custom stylesheet (globals.css content) */
    stylesheet?: string;
    /** Optional stylesheet path (from config) to locate content in files */
    stylesheetPath?: string;
    /** Enable minification (default: true) */
    minify?: boolean;
}
/**
 * Pre-generate and cache CSS from file list.
 *
 * This extracts Tailwind candidates from source files and generates CSS,
 * storing it in the distributed cache for later retrieval during SSR.
 *
 * Should be called after files are fetched but before SSR starts.
 * This is non-blocking and fire-and-forget - errors are logged but not thrown.
 *
 * @param options Pre-generation options
 * @returns Promise that resolves when CSS is generated (or immediately on error)
 */
export declare function pregenerateCSSFromFiles(options: CSSPregenerationOptions): Promise<void>;
/**
 * Find stylesheet content from file list using a configured path or defaults.
 */
export declare function findStylesheetFromFiles(files: Array<{
    path: string;
    content?: string;
}>, stylesheetPath?: string): string | undefined;
/**
 * Find the globals.css content from a file list.
 *
 * Searches for common stylesheet file patterns:
 * - globals.css, global.css
 * - styles/globals.css
 * - app/globals.css
 *
 * @param files List of files with content
 * @returns Stylesheet content or undefined if not found
 */
export declare function findGlobalStylesheet(files: Array<{
    path: string;
    content?: string;
}>): string | undefined;
//# sourceMappingURL=css-pregeneration.d.ts.map