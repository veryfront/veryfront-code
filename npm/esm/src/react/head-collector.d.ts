/**
 * Head Collector - Request-scoped metadata collection for SSR
 *
 * Collects head metadata during React SSR render using AsyncLocalStorage
 * for proper isolation between concurrent requests.
 *
 * Usage:
 *   const { result, head } = await runWithHeadCollector(() => renderToString(element));
 *   // head.title, head.description, head.metas are now available
 */
export interface HeadMeta {
    name?: string;
    property?: string;
    content: string;
}
export interface HeadLink {
    rel?: string;
    href?: string;
    [key: string]: string | undefined;
}
export interface CollectedHead {
    title?: string;
    description?: string;
    metas: HeadMeta[];
    links: HeadLink[];
    styles: string[];
}
/**
 * Run a function with isolated head collection context.
 *
 * @example
 * const { result: html, head } = await runWithHeadCollector(async () => {
 *   return await renderToString(pageElement);
 * });
 * // head.title, head.description, head.metas are now available
 */
export declare function runWithHeadCollector<T>(fn: () => T | Promise<T>): Promise<{
    result: T;
    head: CollectedHead;
}>;
/**
 * Get the current head collection context.
 * Returns null if not within a runWithHeadCollector context.
 */
export declare function getHeadCollectorContext(): CollectedHead | null;
/**
 * Collect head metadata during SSR render.
 * Called by Head component for each child element.
 *
 * Must be called within a runWithHeadCollector context.
 * Calls outside of context are silently ignored (client-side rendering).
 */
export declare function collectHead(data: Partial<CollectedHead>): void;
/**
 * Check if any head data has been collected in the current context.
 */
export declare function hasCollectedHead(): boolean;
/**
 * Reset the head collector for the current context.
 * Only works within a runWithHeadCollector context.
 */
export declare function resetHeadCollector(): void;
/**
 * Flush and return collected head data for the current context.
 * Only works within a runWithHeadCollector context.
 */
export declare function flushHeadCollector(): CollectedHead;
//# sourceMappingURL=head-collector.d.ts.map