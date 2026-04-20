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

import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { isDeno } from "./runtime.ts";
import { dynamicImport } from "./dynamic-import.ts";
import type { NodeCompat } from "../../extensions/interfaces/node-compat.ts";

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
 * Delegates to the `NodeCompat` extension contract (`@veryfront/ext-node-compat`)
 * when available. Without the extension, throws an actionable error instructing
 * the user to install `ext-node-compat`.
 *
 * Node/Bun path: `@kreuzberg/node` resolved from the project's node_modules at
 * runtime — the extension handles that dynamic import internally.
 */
export async function importKreuzberg(): Promise<{
  extractBytes: (
    data: Uint8Array,
    mimeType: string,
  ) => Promise<{ content: string }>;
}> {
  const nodeCompat = tryResolve<NodeCompat>("NodeCompat");
  if (nodeCompat?.importKreuzberg) {
    return nodeCompat.importKreuzberg();
  }
  throw new Error(
    "Document extraction requires the NodeCompat extension. " +
      "Install @veryfront/ext-node-compat and add it to your extensions configuration.",
  );
}
