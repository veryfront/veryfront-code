/**
 * Opaque dynamic imports for heavy optional dependencies.
 *
 * These packages are excluded from the deno.json import map to prevent
 * `deno compile` from bundling them into the binary. The `new Function`
 * pattern makes the import invisible to static analysis so `deno compile`
 * won't trace it.
 *
 * - Deno: resolves via `npm:` specifiers at runtime
 * - Node/Bun: resolves via bare package names from node_modules
 * - Compiled binary: fails (callers must handle the error)
 *
 * Update versions here when upgrading these packages.
 *
 * @module platform/compat
 */

import { isDeno, isDenoCompiled } from "./runtime.ts";
import { dynamicImport } from "./dynamic-import.ts";

function resolve(pkg: string, version: string): string {
  return isDeno ? `npm:${pkg}@${version}` : pkg;
}

// deno-lint-ignore no-explicit-any -- callers assign to their own typed variable; any allows implicit narrowing at each call site
type OpaqueModule = any;

/** Lazily import `@huggingface/transformers` (+ onnxruntime, ~500MB). */
export function importTransformers(): Promise<OpaqueModule> {
  return dynamicImport(resolve("@huggingface/transformers", "3.4.2"));
}

/** Lazily import `@anthropic-ai/claude-agent-sdk` (~69MB). */
export function importClaudeAgentSDK(): Promise<OpaqueModule> {
  // Allow tests to inject a mock SDK without loading the real 69 MB package.
  const mock = (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
  if (mock && typeof mock === "object" && "query" in mock) return Promise.resolve(mock);
  return dynamicImport(resolve("@anthropic-ai/claude-agent-sdk", "0.2.37"));
}

/**
 * Lazily import kreuzberg document extraction.
 *
 * Unlike the other opaque deps above, kreuzberg is a core framework
 * dependency that must work in compiled binaries. The Deno path uses
 * a regular `import()` (not `dynamicImport`) so `deno compile` can
 * trace and embed `@kreuzberg/wasm`. The Node/Bun path uses `dynamicImport`
 * to resolve `@kreuzberg/node` from the project's node_modules at runtime.
 */
export async function importKreuzberg(): Promise<{
  extractBytes: (
    data: Uint8Array,
    mimeType: string,
  ) => Promise<{ content: string }>;
}> {
  if (isDeno) {
    // Regular import — visible to deno compile, resolved via deno.json import map
    const mod = await import("@kreuzberg/wasm") as unknown as
      & { initWasm?: (options?: { wasmModule?: BufferSource }) => Promise<void> }
      & { extractBytes: (data: Uint8Array, mimeType: string) => Promise<{ content: string }> };

    try {
      await mod.initWasm?.();
    } catch (initError) {
      if (!isDenoCompiled) throw initError;

      // In compiled binaries, kreuzberg's initWasm() fails because it uses
      // computed import() paths for the WASM glue code that deno compile
      // cannot trace. Manually import the glue code (traced via deno.json
      // import map entry) and load the WASM binary via fetch().
      const glue = await import("@kreuzberg/wasm/dist/pkg/kreuzberg_wasm.js") as unknown as {
        default: (input?: BufferSource) => Promise<void>;
      };
      const glueUrl = import.meta.resolve("@kreuzberg/wasm/dist/pkg/kreuzberg_wasm.js");
      const wasmUrl = new URL("kreuzberg_wasm_bg.wasm", glueUrl).href;
      const wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
      await glue.default(wasmBinary);
    }

    return mod;
  }
  // Opaque import — resolved from node_modules at runtime
  return dynamicImport("@kreuzberg/node");
}
