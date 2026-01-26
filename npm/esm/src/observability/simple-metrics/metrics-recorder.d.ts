/**
 * Metrics recording operations
 * @module
 */
import type { RSCRequestKind } from "./types.js";
/**
 * Increment request counter
 *
 * @example
 * ```ts
 * await incRequest()
 * ```
 */
export declare function incRequest(): Promise<void>;
/**
 * Record HTTP request statistics
 *
 * @param resolved - Number of resolved requests
 * @param blocked - Number of blocked requests
 * @param fetchMsTotal - Total fetch time in milliseconds
 *
 * @example
 * ```ts
 * recordHttp(10, 2, 150)
 * ```
 */
export declare function recordHttp(resolved: number, blocked: number, fetchMsTotal: number): void;
/**
 * Record cache get operation
 *
 * @param hit - Whether the cache hit or missed
 *
 * @example
 * ```ts
 * recordCacheGet(true) // cache hit
 * recordCacheGet(false) // cache miss
 * ```
 */
export declare function recordCacheGet(hit: boolean): void;
/**
 * Record cache set operation
 *
 * @example
 * ```ts
 * recordCacheSet()
 * ```
 */
export declare function recordCacheSet(): void;
/**
 * Record cache invalidation
 *
 * @param n - Number of entries invalidated
 *
 * @example
 * ```ts
 * recordCacheInvalidate(5)
 * ```
 */
export declare function recordCacheInvalidate(n: number): void;
/**
 * Record SSR render duration
 *
 * @param durationMs - Duration in milliseconds
 *
 * @example
 * ```ts
 * recordSSR(150)
 * ```
 */
export declare function recordSSR(durationMs: number): void;
/**
 * Record RSC stream duration
 *
 * @param durationMs - Duration in milliseconds
 *
 * @example
 * ```ts
 * recordRSCStreamDuration(200)
 * ```
 */
export declare function recordRSCStreamDuration(durationMs: number): void;
/**
 * Record RSC endpoint request
 *
 * @param kind - Type of RSC request
 *
 * @example
 * ```ts
 * recordRSC('page')
 * recordRSC('manifest')
 * ```
 */
export declare function recordRSC(kind: RSCRequestKind): void;
/**
 * Record CORS rejection
 *
 * @example
 * ```ts
 * recordCorsRejection()
 * ```
 */
export declare function recordCorsRejection(): void;
/**
 * Record security headers application
 *
 * @example
 * ```ts
 * recordSecurityHeaders()
 * ```
 */
export declare function recordSecurityHeaders(): void;
export declare function recordApiRequest(status: number): void;
export declare function recordApiRetry(): void;
//# sourceMappingURL=metrics-recorder.d.ts.map