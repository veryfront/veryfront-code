type GlobalWithRuntime = typeof globalThis & {
  process?: { versions?: { node?: string; deno?: string } };
  Bun?: unknown;
};

function hasNodeProcess(): boolean {
  const global = globalThis as GlobalWithRuntime;
  // Check for Node.js process with version, excluding deno shims
  return global.process?.versions?.node != null && !global.process?.versions?.deno;
}

function hasBunGlobal(): boolean {
  return (globalThis as GlobalWithRuntime).Bun != null;
}

function hasRealDeno(): boolean {
  // Check for real Deno, not dnt shim
  // dnt shim doesn't provide Deno.build.os or Deno.mainModule
  return typeof Deno !== "undefined" &&
    typeof Deno.version === "object" &&
    typeof Deno.build === "object" &&
    typeof Deno.build.os === "string";
}

function hasCloudflareGlobals(): boolean {
  return "caches" in globalThis && "WebSocketPair" in globalThis;
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
