import type { HandlerContext } from "../types/server.js";
type MultiProjectRequestContextType = {
    projectSlug: string;
    projectId?: string;
    token: string;
    productionMode: boolean;
    releaseId?: string | null;
    branch?: string | null;
    environmentName?: string | null;
};
export interface CacheKeyContext {
    projectId: string;
    mode: "production" | "preview";
    versionId: string;
}
export declare function getContentHashKey(prefix: string, filePath: string, contentHash: string, suffix?: string): string;
export declare function runWithCacheKeyContext<T>(ctx: CacheKeyContext, fn: () => T): T;
export declare function getCurrentCacheKeyContext(): CacheKeyContext;
export declare function tryGetCacheKeyContext(): CacheKeyContext | null;
export declare function getProjectScopedKey(prefix: string, resourceKey: string): string | null;
export declare function getProjectScopedKeyAlways(prefix: string, resourceKey: string): string | null;
export declare function extractCacheKeyContext(handlerCtx: HandlerContext): CacheKeyContext;
export type { MultiProjectRequestContextType as MultiProjectRequestContext };
/**
 * @deprecated Use tryGetCacheKeyContext() which auto-detects context
 */
export declare function extractCacheKeyContextFromRequestContext(reqCtx: MultiProjectRequestContextType): CacheKeyContext;
//# sourceMappingURL=cache-key-builder.d.ts.map