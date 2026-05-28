/**
 * Runtime detection — inlined from src/platform/compat/runtime.ts so the
 * extension stays dependency-free on core (mirrors ext-bundler-esbuild).
 *
 * The Node check is what makes this correct in the dnt npm build: dnt's
 * `@deno/shim-deno` polyfill makes a bare `Deno` reference truthy on Node/Bun,
 * but `hasNodeProcess()` short-circuits `isDeno` to false there regardless.
 *
 * @module extensions/ext-document-kreuzberg/runtime
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

/** True only in a real Deno runtime — not the dnt shim on Node/Bun. */
export const isDeno: boolean = !hasNodeProcess() && !hasBunGlobal() && hasRealDeno();
