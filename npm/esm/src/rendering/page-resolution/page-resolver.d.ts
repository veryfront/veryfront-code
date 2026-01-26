import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { EntityInfo } from "../../types/index.js";
export interface PageResolverOptions {
    projectDir: string;
    config: VeryfrontConfig;
    adapter: RuntimeAdapter;
}
export declare class PageResolver {
    private projectDir;
    private config;
    private adapter;
    constructor(options: PageResolverOptions);
    resolvePage(slug: string): Promise<EntityInfo>;
    getAllPages(): Promise<string[]>;
    pageExists(slug: string): Promise<boolean>;
    getRouterMode(): Promise<"app" | "pages">;
}
//# sourceMappingURL=page-resolver.d.ts.map