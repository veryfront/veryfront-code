export interface TailwindResult {
    css: string;
    error?: string;
}
export interface GenerateOptions {
    minify?: boolean;
}
export interface CSSErrorInfo {
    title: string;
    message: string;
    suggestion: string;
}
/**
 * Initialize project CSS distributed cache.
 * Call this at server startup alongside other distributed caches.
 *
 * @returns true if distributed backend was successfully initialized
 */
export declare function initializeProjectCSSCache(): Promise<boolean>;
/**
 * Check if distributed project CSS cache is enabled.
 */
export declare function isProjectCSSCacheDistributed(): boolean;
export declare function getProjectCSS(projectSlug: string, stylesheet: string | undefined, candidates: Set<string>, options?: GenerateOptions): Promise<{
    css: string;
    hash: string;
    fromCache: boolean;
}>;
/**
 * Invalidate project CSS cache for a specific project.
 */
export declare function invalidateProjectCSS(projectSlug: string): void;
/**
 * Invalidate project CSS cache for a specific project (async version).
 */
export declare function invalidateProjectCSSAsync(projectSlug: string): Promise<void>;
export declare function hashCSS(css: string): string;
export declare function cacheCSSAsync(css: string, hash?: string): Promise<string>;
export declare function getCSSByHash(hash: string): string | undefined;
export declare function getCSSByHashAsync(hash: string): Promise<string | undefined>;
export declare function clearCSSCache(): void;
/**
 * Regenerate CSS by hash using cached inputs.
 * This is the JIT regeneration path - any pod can regenerate without fetching files.
 *
 * @param expectedHash - The CSS hash to regenerate
 * @returns The regenerated CSS if inputs are cached and hash matches, undefined otherwise
 */
export declare function regenerateCSSByHash(expectedHash: string): Promise<string | undefined>;
/**
 * Extract Tailwind CSS v4 class candidates from content.
 *
 * Supports all Tailwind v4 features including:
 * - Basic utilities: mt-4, bg-blue-500
 * - Negative values: -mt-4, -translate-x-1/2
 * - Important modifier: !mt-4, !text-red-500
 * - Responsive/state variants: sm:mt-4, hover:bg-blue, dark:text-white
 * - Arbitrary values: w-[100px], bg-[#ff0000], bg-[var(--color)]
 * - Arbitrary properties: [mask-type:alpha], [--my-var:value]
 * - Arbitrary variants: [&>*]:mt-4, [&:hover]:bg-blue
 * - Container queries: @container, @lg:flex, @[200px]:grid
 * - Opacity modifier: bg-black/50
 * - Fractions: w-1/2
 * - CSS variable utilities: text-[--my-color], bg-[--theme-bg]
 * - 3D transforms: rotate-x-45, perspective-500
 */
export declare function extractCandidates(content: string): string[];
export declare function extractCandidatesFromFiles(files: Array<{
    path: string;
    content?: string;
}>): Set<string>;
export declare function clearPluginCache(id?: string): void;
export declare function invalidateCompiler(): void;
export declare function generateTailwindCSS(stylesheet: string | undefined, candidates: string[] | Set<string>, options?: GenerateOptions): Promise<TailwindResult>;
export declare function formatCSSError(error: Error | string): CSSErrorInfo;
/** @deprecated Use generateTailwindCSS with explicit candidates instead */
export declare function generateTailwind4CSS(html: string): Promise<string>;
/** @deprecated Use generateTailwindCSS instead */
export declare function compileGlobalsCSS(css: string): Promise<string>;
//# sourceMappingURL=tailwind-compiler.d.ts.map