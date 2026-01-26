import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { HandlerContext, ParsedDomain } from "../../types/server.js";
export type Environment = "preview" | "production";
export type RenderMode = "development" | "production";
export interface ProjectData {
    id: string;
    slug: string;
    name?: string;
    updated_at?: string;
    [key: string]: unknown;
}
export interface EnrichedContext {
    projectId: string;
    projectSlug: string;
    projectDir: string;
    token: string;
    environment: Environment;
    branch: string | null;
    isLocalDev: boolean;
    mode: RenderMode;
    /** Content source identifier for cache isolation (e.g., "release-abc123", "preview-main", "local-main") */
    contentSourceId: string;
    releaseId?: string;
    environmentName?: string;
    parsedDomain: ParsedDomain;
    projectData?: ProjectData;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    cachePrefix: string;
    moduleServerUrl?: string;
    nonce?: string;
    debug?: boolean;
    createdAt: number;
}
export interface BuildEnrichedContextOptions {
    projectId: string;
    projectSlug: string;
    projectDir: string;
    token: string;
    environment: Environment;
    branch: string | null;
    isLocalDev: boolean;
    /** Content source identifier for cache isolation - computed by proxy */
    contentSourceId: string;
    parsedDomain: ParsedDomain;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    releaseId?: string;
    environmentName?: string;
    projectData?: ProjectData;
    moduleServerUrl?: string;
    nonce?: string;
    debug?: boolean;
}
export declare function buildEnrichedContext(options: BuildEnrichedContextOptions): EnrichedContext;
export declare function toRequestContext(enriched: EnrichedContext): {
    token: string;
    slug: string;
    branch: string | null;
    mode: Environment;
    isLocalDev: boolean;
};
export declare function shouldEnableCacheFromEnriched(enriched: EnrichedContext): boolean;
export declare function shouldUseNoCacheHeadersFromEnriched(enriched: EnrichedContext): boolean;
export declare function shouldUseNoCacheHeadersFromHandler(ctx: HandlerContext): boolean;
//# sourceMappingURL=enriched-context.d.ts.map