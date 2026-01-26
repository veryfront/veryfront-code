/**********************************
 * Redis Adapter Utilities
 *
 * Helper functions for Redis adapters.
 *
 * @module platform/adapters/redis/utils
 **********************************/
/**
 * Convert array [k1, v1, k2, v2] to object { k1: v1, k2: v2 }
 * Used for Deno redis which returns hgetall results as arrays.
 */
export declare function arrayToObject(arr: string[]): Record<string, string>;
//# sourceMappingURL=utils.d.ts.map