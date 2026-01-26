/**
 * SSR HTTP Cache Stage - caches HTTP imports to local file:// paths.
 *
 * Deno supports HTTP imports, but Node.js and Bun don't.
 * This stage normalizes all SSR dependencies by downloading HTTP modules
 * (esm.sh, npm:, etc.) into a shared cache and rewriting imports to file://.
 * This keeps SSR runtime-agnostic and avoids loader hooks.
 */
import type { TransformPlugin } from "../types.js";
export declare const ssrHttpCachePlugin: TransformPlugin;
//# sourceMappingURL=ssr-http-cache.d.ts.map