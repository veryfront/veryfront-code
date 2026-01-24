type GlobalWithRuntime = typeof globalThis & {
  process?: { versions?: { node?: string } };
  Bun?: unknown;
};

function hasDenoVersion(): boolean {
  return typeof Deno !== "undefined" && typeof Deno.version === "object";
}

function hasNodeProcess(): boolean {
  const global = globalThis as GlobalWithRuntime;
  return global.process?.versions?.node != null;
}

function hasBunGlobal(): boolean {
  return (globalThis as GlobalWithRuntime).Bun != null;
}

function hasCloudflareGlobals(): boolean {
  return "caches" in globalThis && "WebSocketPair" in globalThis;
}

/** True if running in Deno runtime */
export const isDeno: boolean = hasDenoVersion();

/** True if running in Bun runtime (must check before Node since Bun has process.versions.node) */
export const isBun: boolean = !isDeno && hasBunGlobal();

/** True if running in Node.js runtime (exclude Bun which also has process.versions.node) */
export const isNode: boolean = !isDeno && !isBun && hasNodeProcess();

/** True if running in Cloudflare Workers runtime */
export const isCloudflare: boolean = hasCloudflareGlobals();

/**
 * Detect if running in Node.js (vs Deno) at call time.
 * Use this function instead of the constant when runtime detection needs to happen
 * at call time (e.g., when bundled with esbuild's __esm lazy initialization pattern).
 */
export function isNodeRuntime(): boolean {
  return !hasDenoVersion() && !hasBunGlobal() && hasNodeProcess();
}
