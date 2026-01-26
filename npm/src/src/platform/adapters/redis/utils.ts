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
export function arrayToObject(arr: string[]): Record<string, string> {
  const obj: Record<string, string> = {};

  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    if (!key) continue;

    const value = arr[i + 1];
    if (value === undefined) continue;

    obj[key] = value;
  }

  return obj;
}
