/**
 * Runtime detection — inlined from src/platform/compat/runtime.ts so the
 * extension stays dependency-free on core.
 *
 * Only the bits needed by the esbuild binary extractor are included here.
 *
 * @module extensions/ext-esbuild/runtime
 */

type GlobalWithRuntime = typeof globalThis & {
  process?: { versions?: { node?: string; deno?: string } };
  Bun?: unknown;
};

function hasRealDeno(): boolean {
  return (
    typeof Deno !== "undefined" &&
    typeof Deno.version === "object" &&
    typeof Deno.build === "object" &&
    typeof Deno.build.os === "string"
  );
}

function hasBunGlobal(): boolean {
  return (globalThis as GlobalWithRuntime).Bun != null;
}

function hasNodeProcess(): boolean {
  const g = globalThis as GlobalWithRuntime;
  return g.process?.versions?.node != null && !g.process?.versions?.deno;
}

export const isDeno: boolean = !hasNodeProcess() && !hasBunGlobal() && hasRealDeno();

function testDenoCompiledDetection(execPath: string): boolean {
  if (!execPath) return false;
  const binary = execPath.split(/[/\\]/).pop()?.toLowerCase();
  if (!binary) return false;
  return binary !== "deno" && binary !== "deno.exe";
}

function isDenoCompiledBinary(): boolean {
  if (!hasRealDeno()) return false;
  try {
    return testDenoCompiledDetection(Deno.execPath());
  } catch {
    return false;
  }
}

/** True if running inside a `deno compile`'d binary (needs VFS extraction). */
export const isDenoCompiled: boolean = isDeno && isDenoCompiledBinary();
