type GlobalWithRuntime = typeof globalThis & {
  process?: { versions?: { node?: string; deno?: string } };
  Bun?: unknown;
};

export type RuntimeKind = "bun" | "cloudflare" | "deno" | "node" | "unknown";

/** @internal Exported so overlapping host signals can be regression-tested. */
export function classifyRuntimeSignals(signals: {
  bun: boolean;
  cloudflare: boolean;
  deno: boolean;
  node: boolean;
}): RuntimeKind {
  // Bun exposes Node compatibility globals. Cloudflare Workers can do the same
  // when nodejs_compat is enabled, so the more specific host signals must win.
  if (signals.bun) return "bun";
  if (signals.cloudflare) return "cloudflare";
  if (signals.node) return "node";
  if (signals.deno) return "deno";
  return "unknown";
}

function hasNodeProcess(): boolean {
  const global = globalThis as GlobalWithRuntime;
  return global.process?.versions?.node != null && !global.process?.versions?.deno;
}

function hasBunGlobal(): boolean {
  return (globalThis as GlobalWithRuntime).Bun != null;
}

export function getDenoRuntime(): typeof Deno | undefined {
  const deno = Reflect.get(globalThis, "Deno") as typeof Deno | undefined;
  if (
    deno &&
    typeof deno.version === "object" &&
    typeof deno.build === "object" &&
    typeof deno.build.os === "string"
  ) {
    return deno;
  }
  return undefined;
}

function hasRealDeno(): boolean {
  return getDenoRuntime() != null;
}

/**
 * Check if an executable path is a compiled Deno binary.
 * Detects by binary name: "deno" or "deno.exe" = standard runtime, anything else = compiled.
 * @internal Exported for testing only.
 */
export function testDenoCompiledDetection(execPath: string, standalone?: boolean): boolean {
  if (standalone !== undefined) return standalone;
  if (!execPath) return false;

  const binaryName = execPath.split(/[/\\]/).pop()?.toLowerCase();
  if (!binaryName) return false;

  return binaryName !== "deno" && binaryName !== "deno.exe";
}

/** Compiled Deno binaries cannot dynamically import HTTP URLs at runtime. */
function isDenoCompiledBinary(): boolean {
  const deno = getDenoRuntime();
  if (!deno) return false;

  try {
    const standalone = Reflect.get(deno.build, "standalone");
    return testDenoCompiledDetection(
      deno.execPath(),
      typeof standalone === "boolean" ? standalone : undefined,
    );
  } catch (_) {
    /* expected: Deno.execPath() may not be available in all environments */
    return false;
  }
}

function hasCloudflareGlobals(): boolean {
  return "caches" in globalThis && "WebSocketPair" in globalThis;
}

export const runtimeKind: RuntimeKind = classifyRuntimeSignals({
  bun: hasBunGlobal(),
  cloudflare: hasCloudflareGlobals(),
  deno: hasRealDeno(),
  node: hasNodeProcess(),
});

/** True if running in Bun runtime (Bun also exposes process.versions.node). */
export const isBun: boolean = runtimeKind === "bun";

/** True if running in Cloudflare Workers, including nodejs_compat workers. */
export const isCloudflare: boolean = runtimeKind === "cloudflare";

/** True if running in Node.js rather than a more specific compatible host. */
export const isNode: boolean = runtimeKind === "node";

/** True if running in the real Deno runtime rather than a dnt shim. */
export const isDeno: boolean = runtimeKind === "deno";

/**
 * True if running in a compiled Deno binary.
 * Compiled binaries cannot dynamically import HTTP URLs - they must use local file:// paths.
 * This is evaluated once at module load time.
 */
export const isDenoCompiled: boolean = isDeno && isDenoCompiledBinary();

/**
 * Detect if running in Node.js (vs Deno) at call time.
 * Use this function instead of the constant when runtime detection needs to happen
 * at call time (e.g., when bundled with esbuild's __esm lazy initialization pattern).
 */
export function isNodeRuntime(): boolean {
  return classifyRuntimeSignals({
    bun: hasBunGlobal(),
    cloudflare: hasCloudflareGlobals(),
    deno: false,
    node: hasNodeProcess(),
  }) === "node";
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
