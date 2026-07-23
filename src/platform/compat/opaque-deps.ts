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
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { isDeno } from "./runtime.ts";
import { dynamicImport } from "./dynamic-import.ts";
import type {
  DocumentExtractor,
  KreuzbergExtractor,
} from "#veryfront/extensions/compat/native-services.ts";
import { OPAQUE_DEPENDENCY_VERSIONS } from "./opaque-dependency-versions.ts";

function resolve(pkg: string, version: string): string {
  return isDeno ? `npm:${pkg}@${version}` : pkg;
}

// deno-lint-ignore no-explicit-any -- callers assign to their own typed variable; any allows implicit narrowing at each call site
type OpaqueModule = any;

/** Lazily import `@huggingface/transformers` (+ onnxruntime, ~500MB). */
export function importTransformers(): Promise<OpaqueModule> {
  return dynamicImport(resolve(
    "@huggingface/transformers",
    OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"],
  ));
}

/** Lazily import `@anthropic-ai/claude-agent-sdk` (~69MB). */
export function importClaudeAgentSDK(): Promise<OpaqueModule> {
  return dynamicImport(resolve(
    "@anthropic-ai/claude-agent-sdk",
    OPAQUE_DEPENDENCY_VERSIONS["@anthropic-ai/claude-agent-sdk"],
  ));
}

/**
 * Lazily import kreuzberg document extraction.
 *
 * Delegates to the `DocumentExtractor` extension contract
 * (`@veryfront/ext-document-kreuzberg`)
 * when available. Without the extension, throws an actionable error instructing
 * the user to install `ext-document-kreuzberg`.
 *
 * Node/Bun path: `@kreuzberg/node` resolved from the project's node_modules at
 * runtime. The extension handles that dynamic import internally.
 */
export async function importKreuzberg(): Promise<KreuzbergExtractor> {
  const extractor = tryResolve<DocumentExtractor>("DocumentExtractor");
  if (extractor?.importKreuzberg) {
    return extractor.importKreuzberg();
  }
  throw NOT_SUPPORTED.create({
    message: "Document extraction requires a DocumentExtractor extension. " +
      "Install @veryfront/ext-document-kreuzberg and add it to your extensions configuration.",
  });
}
