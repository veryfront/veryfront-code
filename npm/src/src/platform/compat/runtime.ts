import * as dntShim from "../../../_dnt.shims.js";
type GlobalWithRuntime = typeof dntShim.dntGlobalThis & {
  process?: { versions?: { node?: string; deno?: string } };
  Bun?: unknown;
};

function hasNodeProcess(): boolean {
  const global = dntShim.dntGlobalThis as GlobalWithRuntime;
  // Check for Node.js process with version, excluding deno shims
  return global.process?.versions?.node != null && !global.process?.versions?.deno;
}

function hasBunGlobal(): boolean {
  return (dntShim.dntGlobalThis as GlobalWithRuntime).Bun != null;
}

function hasRealDeno(): boolean {
  // Check for real Deno, not dnt shim
  // dnt shim doesn't provide Deno.build.os or Deno.mainModule
  return typeof dntShim.Deno !== "undefined" &&
    typeof dntShim.Deno.version === "object" &&
    typeof dntShim.Deno.build === "object" &&
    typeof dntShim.Deno.build.os === "string";
}

function hasCloudflareGlobals(): boolean {
  return "caches" in dntShim.dntGlobalThis && "WebSocketPair" in dntShim.dntGlobalThis;
}

/** True if running in Bun runtime (check first since Bun has process.versions.node) */
export const isBun: boolean = hasBunGlobal();

/** True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) */
export const isNode: boolean = !isBun && hasNodeProcess();

/** True if running in real Deno runtime (not dnt shim) */
export const isDeno: boolean = !isNode && !isBun && hasRealDeno();

/** True if running in Cloudflare Workers runtime */
export const isCloudflare: boolean = hasCloudflareGlobals();

/**
 * Detect if running in Node.js (vs Deno) at call time.
 * Use this function instead of the constant when runtime detection needs to happen
 * at call time (e.g., when bundled with esbuild's __esm lazy initialization pattern).
 */
export function isNodeRuntime(): boolean {
  return !hasBunGlobal() && hasNodeProcess();
}

/**
 * Detect if code is executing in a server environment (SSR).
 *
 * This function provides consistent SSR detection that works correctly even when
 * SSR globals stub the window/document objects. It should be used instead of
 * `typeof window === "undefined"` checks to avoid hydration mismatches.
 *
 * Priority:
 * 1. Check __VERYFRONT_SSR__ flag (set by ssr-globals/index.ts) - most reliable
 * 2. Check if window is undefined (fallback for non-veryfront environments)
 *
 * @returns true if executing on server, false if in browser
 * @see plans/architecture-audit/006.1-ssr-detection-inconsistencies.md
 */
export function isServerEnvironment(): boolean {
  // Check explicit SSR flag first (most reliable - set by setupSSRGlobals)
  const ssrFlag = (dntShim.dntGlobalThis as Record<string, unknown>).__VERYFRONT_SSR__;
  if (ssrFlag === true) return true;

  // Fall back to window check for non-veryfront environments
  return typeof dntShim.dntGlobalThis === "undefined";
}

/**
 * Detect if code is executing in a browser environment.
 * Inverse of isServerEnvironment() - use this instead of `typeof window !== "undefined"`.
 *
 * @returns true if executing in browser, false if on server
 */
export function isBrowserEnvironment(): boolean {
  return !isServerEnvironment();
}
