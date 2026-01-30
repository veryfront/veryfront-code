/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
export { getAppRouteEntity } from "./app-route-resolver.js";
/**
 * Clear the router detection cache. Call when filesystem changes.
 * @deprecated Use clearRouterDetectionCacheForProject for multi-tenant deployments
 */
export declare function clearRouterDetectionCache(): void;
/**
 * Clear the router detection cache for a specific project.
 * Use this in multi-tenant deployments to avoid clearing other projects' caches.
 */
export declare function clearRouterDetectionCacheForProject(projectDir: string): void;
/**
 * Detect if app router should be used based on config and directory structure
 */
export declare function detectAppRouter(projectDir: string, config: VeryfrontConfig, adapter: RuntimeAdapter): Promise<boolean>;
//# sourceMappingURL=router-detection.d.ts.map