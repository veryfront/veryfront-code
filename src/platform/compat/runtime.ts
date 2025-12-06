export const isDeno = typeof Deno !== "undefined";
export const isNode =
  typeof (globalThis as { process?: { versions?: { node?: string } } }).process !== "undefined" &&
  (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !==
    undefined;
export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
export const isCloudflare = typeof globalThis !== "undefined" && "caches" in globalThis &&
  "WebSocketPair" in globalThis;

/**
 * Detect if running in Node.js (vs Deno)
 * Use this function instead of the constant when runtime detection needs to happen
 * at call time (e.g., when bundled with esbuild's __esm lazy initialization pattern)
 */
export function isNodeRuntime(): boolean {
  // deno-lint-ignore no-explicit-any
  const _global = globalThis as any;
  return typeof Deno === "undefined" && typeof _global.process !== "undefined" &&
    !!_global.process?.versions?.node;
}
