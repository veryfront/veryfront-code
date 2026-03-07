type GlobalWithRuntime = typeof globalThis & {
  process?: { versions?: { node?: string; deno?: string } };
  Bun?: unknown;
};

function hasNodeProcess(): boolean {
  const global = globalThis as GlobalWithRuntime;
  return global.process?.versions?.node != null && !global.process?.versions?.deno;
}

function hasBunGlobal(): boolean {
  return (globalThis as GlobalWithRuntime).Bun != null;
}

function hasRealDeno(): boolean {
  return (
    typeof Deno !== "undefined" &&
    typeof Deno.version === "object" &&
    typeof Deno.build === "object" &&
    typeof Deno.build.os === "string"
  );
}

/**
 * Check if an executable path is a compiled Deno binary.
 * Detects by binary name: "deno" or "deno.exe" = standard runtime, anything else = compiled.
 * @internal Exported for testing only.
 */
export function testDenoCompiledDetection(execPath: string): boolean {
  if (!execPath) return false;

  const binaryName = execPath.split(/[/\\]/).pop()?.toLowerCase();
  if (!binaryName) return false;

  return binaryName !== "deno" && binaryName !== "deno.exe";
}

/** Compiled Deno binaries cannot dynamically import HTTP URLs at runtime. */
function isDenoCompiledBinary(): boolean {
  if (!hasRealDeno()) return false;

  try {
    return testDenoCompiledDetection(Deno.execPath());
  } catch (_) {
    /* expected: Deno.execPath() may not be available in all environments */
    return false;
  }
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

/**
 * True if running in a compiled Deno binary.
 * Compiled binaries cannot dynamically import HTTP URLs - they must use local file:// paths.
 * This is evaluated once at module load time.
 */
export const isDenoCompiled: boolean = isDeno && isDenoCompiledBinary();

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
  const ssrFlag = (globalThis as Record<string, unknown>).__VERYFRONT_SSR__;
  if (ssrFlag === true) return true;

  return typeof window === "undefined";
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
