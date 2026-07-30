/**
 * @deprecated Import from `#veryfront/compat/std/fs.ts` instead.
 *
 * This path remains as a compatibility alias. The implementation lives in one
 * canonical module so traversal and error behavior cannot drift by runtime.
 */
export { ensureDir, exists, existsSync, walk } from "../std/fs.ts";
export type { ExistsOptions, WalkEntry, WalkOptions } from "../std/fs.ts";
