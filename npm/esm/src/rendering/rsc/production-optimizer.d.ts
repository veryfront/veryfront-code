import type { RSCPayload } from "./types.js";
export declare class RSCProductionOptimizer {
    static optimizePayload(payload: RSCPayload): RSCPayload;
    private static minifyHTML;
    static getCacheHeaders(options?: {
        isStatic?: boolean;
        maxAge?: number;
    }): Record<string, string>;
    static generateETag(payload: RSCPayload): string;
    static checkETag(requestETag: string | null, payloadETag: string): boolean;
    static optimizeClientRefs(clientRefs: Record<string, string>, cdnPrefix?: string): Record<string, string>;
    static bundlePayloads(payloads: Map<string, RSCPayload>): {
        bundles: Record<string, RSCPayload>;
        manifest: Record<string, string[]>;
    };
    private static generateBundleId;
    static generatePreloadLinks(clientRefs: Record<string, string>): string[];
    /**
     * CSP directives for RSC JSON responses.
     * Note: For HTML responses, use the security config with nonce support instead.
     * This is intentionally strict since RSC responses are JSON, not HTML with inline scripts.
     */
    static getCSPDirectives(): Record<string, string[]>;
    static generateCSP(): string;
}
//# sourceMappingURL=production-optimizer.d.ts.map