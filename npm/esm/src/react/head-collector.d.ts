/**
 * Head Collector - Request-scoped metadata collection for SSR
 *
 * Collects head metadata during React SSR render, avoiding HTML parsing.
 * Works across Deno, Bun, and Node.js with no external dependencies.
 *
 * Usage:
 *   resetHeadCollector()           // Before render
 *   collectHead({ title: "..." })  // During render (from Head component)
 *   const data = flushHeadCollector()  // After render
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
 * Collect head metadata during SSR render.
 * Called by Head component for each child element.
 */
export declare function collectHead(data: Partial<CollectedHead>): void;
/**
 * Flush collected head data and reset for next request.
 * Call after SSR render completes.
 */
export declare function flushHeadCollector(): CollectedHead;
/**
 * Reset collector before SSR render.
 * Ensures clean state for each request.
 */
export declare function resetHeadCollector(): void;
/**
 * Check if any head data has been collected.
 */
export declare function hasCollectedHead(): boolean;
//# sourceMappingURL=head-collector.d.ts.map