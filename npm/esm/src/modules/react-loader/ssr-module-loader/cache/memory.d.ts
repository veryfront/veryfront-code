/**
 * Memory Cache for SSR Modules - Redis-First Architecture
 *
 * Optimized for ephemeral pods with limited memory.
 *
 * Strategy:
 * - Redis: Primary storage for transformed code (shared across pods)
 * - Memory: Small LRU cache for temp file path tracking only
 *
 * The actual transformed code lives in Redis and temp files.
 * Memory only stores { tempPath, contentHash } pointers.
 *
 * @module module-system/react-loader/ssr-module-loader/cache/memory
 */
import { LRUCache } from "../../../../utils/lru-wrapper.js";
import { Semaphore } from "../concurrency/semaphore.js";
import type { FailureRecord, ModuleCacheEntry } from "../types.js";
export declare const globalModuleCache: LRUCache<string, ModuleCacheEntry>;
export declare const globalCrossProjectCache: LRUCache<string, ModuleCacheEntry>;
export declare const globalInProgress: Map<string, Promise<void>>;
export declare const globalTmpDirs: LRUCache<string, string>;
export declare const failedComponents: Map<string, FailureRecord>;
export declare const transformSemaphore: Semaphore;
export declare function clearSSRModuleCache(): void;
export declare function clearSSRModuleCacheForProject(projectId: string): void;
//# sourceMappingURL=memory.d.ts.map