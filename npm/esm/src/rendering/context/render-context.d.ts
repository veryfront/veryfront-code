import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { HandlerContext } from "../../server/handlers/types.js";
import type { EnrichedContext } from "../../server/context/enriched-context.js";
import { parseRenderCacheKey } from "../../cache/keys.js";
export type RenderEnvironment = "preview" | "production";
export interface RenderContext {
    projectId: string;
    projectSlug: string;
    projectDir: string;
    config: VeryfrontConfig;
    mode: "development" | "production";
    adapter: RuntimeAdapter;
    cachePrefix: string;
    environment: RenderEnvironment;
    /** Content source identifier for cache isolation (e.g., "release-abc123", "preview-main", "local-main") */
    contentSourceId: string;
    branch?: string | null;
    releaseId?: string;
    proxyToken?: string;
    moduleServerUrl?: string;
    port?: number;
    nonce?: string;
}
export interface CreateRenderContextOptions {
    port?: number;
    moduleServerUrl?: string;
    nonce?: string;
}
export declare function createRenderContext(ctx: HandlerContext, options?: CreateRenderContextOptions): RenderContext;
export declare function createRenderContextFromEnriched(enriched: EnrichedContext, options?: CreateRenderContextOptions): RenderContext;
export declare function createCacheKey(ctx: RenderContext, contentKey: string): string;
export declare const parseCacheKey: typeof parseRenderCacheKey;
export declare function isSameTenant(a: RenderContext, b: RenderContext): boolean;
//# sourceMappingURL=render-context.d.ts.map