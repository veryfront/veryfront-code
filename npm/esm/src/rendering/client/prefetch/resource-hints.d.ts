export interface ResourceHint {
    type: "prefetch" | "preload" | "preconnect" | "dns-prefetch";
    href: string;
    as?: string;
    crossOrigin?: string;
    media?: string;
}
export declare class ResourceHintsManager {
    private appliedHints;
    applyResourceHints(hints: ResourceHint[]): void;
    private createAndAppendHint;
    extractResourceHints(html: string, prefetchedUrls: Set<string>): ResourceHint[];
    private isValidResourceHintType;
    private extractPreloadLinks;
    private extractScripts;
    private extractStylesheets;
    static generateResourceHints(_route: string, assets: string[]): string;
}
//# sourceMappingURL=resource-hints.d.ts.map