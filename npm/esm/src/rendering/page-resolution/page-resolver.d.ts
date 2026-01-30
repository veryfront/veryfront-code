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
    /**
     * Discover all pages from both App Router and Pages Router directories.
     * This is used for SSG to determine which pages need to be statically generated.
     *
     * @see plans/architecture-audit/005.2-ssg-getallpages-missing-app-router.md
     */
    getAllPages(): Promise<string[]>;
    /**
     * Recursively discover all page.tsx files in the App Router directory.
     * Handles route groups (parentheses) and parallel routes (@).
     */
    private discoverAppRouterPages;
    pageExists(slug: string): Promise<boolean>;
    getRouterMode(): Promise<"app" | "pages">;
}
//# sourceMappingURL=page-resolver.d.ts.map