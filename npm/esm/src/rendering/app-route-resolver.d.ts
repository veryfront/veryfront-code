/**
 * App Router Entity Resolution
 *
 * Handles resolution of App Router page entities, including:
 * - Exact route matching
 * - Dynamic segment matching ([id], [...slug], etc.)
 * - Page file loading with frontmatter extraction
 */
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { EntityInfo } from "../types/index.js";
export declare function getAppRouteEntity(projectDir: string, slug: string, adapter: RuntimeAdapter, appDirName?: string): Promise<EntityInfo | null>;
//# sourceMappingURL=app-route-resolver.d.ts.map