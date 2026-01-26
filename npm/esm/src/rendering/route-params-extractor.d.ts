import type { RuntimeAdapter } from "../platform/adapters/base.js";
export declare function extractAppRouteParams(projectDir: string, slug: string, adapter: RuntimeAdapter): Promise<Record<string, string | string[]> | null>;
export declare function extractPagesRouteParams(projectDir: string, slug: string, adapter: RuntimeAdapter): Promise<Record<string, string | string[]> | null>;
//# sourceMappingURL=route-params-extractor.d.ts.map