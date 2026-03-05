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

import { isDeno } from "./runtime.ts";
import { dynamicImport } from "./dynamic-import.ts";

function resolve(pkg: string, version: string): string {
  return isDeno ? `npm:${pkg}@${version}` : pkg;
}

/** Lazily import `@huggingface/transformers` (+ onnxruntime, ~500MB). */
export function importTransformers(): Promise<any> {
  return dynamicImport(resolve("@huggingface/transformers", "3.4.2"));
}

/** Lazily import `@anthropic-ai/claude-agent-sdk` (~69MB). */
export function importClaudeAgentSDK(): Promise<any> {
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
    const mod = await import("@kreuzberg/wasm");
    await (mod as any).initWasm();
    return mod as any;
  }
  // Opaque import — resolved from node_modules at runtime
  return dynamicImport("@kreuzberg/node");
}
