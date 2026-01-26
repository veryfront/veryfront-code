import { type RuntimeEnv } from "../../../config/runtime-env.js";
export interface ReserveResult {
    slug: string;
    projectId: string;
    created: boolean;
}
export declare function reserveProjectSlug(slug: string, token: string, env?: RuntimeEnv): Promise<ReserveResult>;
export declare function isSlugAvailable(slug: string, token: string, env?: RuntimeEnv): Promise<boolean>;
//# sourceMappingURL=reserve-slug.d.ts.map