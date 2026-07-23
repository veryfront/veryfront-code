export type DetectedRuntime = "deno" | "node" | "bun" | "cloudflare" | "unknown";

type PropertyHost = object | ((...args: never[]) => unknown);

function isPropertyHost(value: unknown): value is PropertyHost {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readProperty(value: unknown, key: PropertyKey): unknown {
  if (!isPropertyHost(value)) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCloudflareRuntime(host: unknown): boolean {
  const navigator = readProperty(host, "navigator");
  if (readProperty(navigator, "userAgent") === "Cloudflare-Workers") return true;

  return isPropertyHost(readProperty(host, "caches")) &&
    typeof readProperty(host, "WebSocketPair") === "function";
}

function hasBunRuntime(host: unknown): boolean {
  const bun = readProperty(host, "Bun");
  return isNonEmptyString(readProperty(bun, "version")) &&
    typeof readProperty(bun, "serve") === "function";
}

function hasNodeRuntime(host: unknown): boolean {
  const process = readProperty(host, "process");
  const versions = readProperty(process, "versions");
  const release = readProperty(process, "release");
  return isNonEmptyString(readProperty(versions, "node")) &&
    !isNonEmptyString(readProperty(versions, "deno")) &&
    readProperty(release, "name") === "node" &&
    typeof readProperty(process, "cwd") === "function";
}

function hasDenoRuntime(host: unknown): boolean {
  const deno = readProperty(host, "Deno");
  const version = readProperty(deno, "version");
  const build = readProperty(deno, "build");
  return isNonEmptyString(readProperty(version, "deno")) &&
    isNonEmptyString(readProperty(build, "os")) &&
    typeof readProperty(deno, "execPath") === "function";
}

/**
 * Classify a supplied host without mutating globals.
 *
 * Cloudflare must win over its Node-compatible process shim. Bun must win over
 * its Node-compatible process object. Node wins over an injected dnt Deno shim.
 */
export function detectRuntimeFromHost(host: unknown): DetectedRuntime {
  if (hasCloudflareRuntime(host)) return "cloudflare";
  if (hasBunRuntime(host)) return "bun";
  if (hasNodeRuntime(host)) return "node";
  if (hasDenoRuntime(host)) return "deno";
  return "unknown";
}

function preferredRuntimeHost(): unknown {
  // dnt does not rewrite `self`; using it preserves the native Deno and Worker
  // host. Node normally has no `self`, while Veryfront SSR may install a
  // browser-shaped stub. Unknown preferred hosts fall back to globalThis so
  // that stub cannot hide the native Node process.
  try {
    if (typeof self !== "undefined") return self;
  } catch {
    // Continue with the universal host below.
  }
  return globalThis;
}

/** Classify a preferred host, falling back only when it has no runtime. */
export function detectRuntimeFromHosts(
  preferredHost: unknown,
  universalHost: unknown,
): DetectedRuntime {
  const preferredRuntime = detectRuntimeFromHost(preferredHost);
  return preferredRuntime === "unknown" ? detectRuntimeFromHost(universalHost) : preferredRuntime;
}

export function detectRuntimeEnvironment(): DetectedRuntime {
  return detectRuntimeFromHosts(preferredRuntimeHost(), globalThis);
}

export function getDenoRuntime(): typeof Deno | undefined {
  const preferredHost = preferredRuntimeHost();
  if (detectRuntimeFromHost(preferredHost) === "deno") {
    return readProperty(preferredHost, "Deno") as typeof Deno;
  }
  if (detectRuntimeFromHost(globalThis) !== "deno") return undefined;
  return readProperty(globalThis, "Deno") as typeof Deno;
}

/**
 * Check if an executable path is a compiled Deno binary.
 * Uses Deno's standalone signal when available. Older runtimes fall back to
 * executable names: deno and deno.exe identify the standard runtime.
 * @internal Exported for testing only.
 */
export function testDenoCompiledDetection(execPath: string, standalone?: boolean): boolean {
  if (standalone !== undefined) return standalone === true;
  if (typeof execPath !== "string" || !execPath) return false;

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
  } catch {
    return false;
  }
}

const detectedRuntime = detectRuntimeEnvironment();

/** True if running in Bun. */
export const isBun = detectedRuntime === "bun";

/** True if running in Node.js. */
export const isNode = detectedRuntime === "node";

/** True if running in native Deno rather than a compatibility shim. */
export const isDeno = detectedRuntime === "deno";

/** True if running in Cloudflare Workers. */
export const isCloudflare = detectedRuntime === "cloudflare";

/** True when the native Deno runtime is a compiled executable. */
export const isDenoCompiled = isDeno && isDenoCompiledBinary();

/** Detect Node.js at call time for lazy bundled initialization paths. */
export function isNodeRuntime(): boolean {
  return detectRuntimeEnvironment() === "node";
}

/** Detect whether code is executing in a server environment. */
export function isServerEnvironment(): boolean {
  if (readProperty(globalThis, "__VERYFRONT_SSR__") === true) return true;
  return readProperty(globalThis, "window") === undefined;
}

/** Detect whether code is executing in a browser environment. */
export function isBrowserEnvironment(): boolean {
  return !isServerEnvironment();
}
