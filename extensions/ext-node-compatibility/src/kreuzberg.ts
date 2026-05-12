/**
 * Shared kreuzberg loader for the ext-node-compatibility extension.
 *
 * Used by both `NodeCompatImpl.importKreuzberg()` (direct calls from
 * Node/Bun) and the extension's upload-extraction worker (Deno isolate).
 * Centralising the loader keeps the compiled-binary WASM glue + pdfium
 * pre-import dance in one place.
 *
 * @module extensions/ext-node-compatibility/kreuzberg
 */

import type { KreuzbergExtractor } from "veryfront/extensions/compat";

type KreuzbergModule = {
  initWasm?: () => Promise<void>;
  extractBytes: (
    data: Uint8Array,
    mimeType: string,
  ) => Promise<{ content: string }>;
};

// deno-lint-ignore no-explicit-any
async function loadKreuzbergNode(): Promise<any> {
  return await import("@kreuzberg/node");
}

export async function loadKreuzberg(): Promise<KreuzbergExtractor> {
  const isDeno = typeof Deno !== "undefined";

  if (!isDeno) {
    return loadKreuzbergNode();
  }

  const mod = await import("@kreuzberg/wasm") as unknown as KreuzbergModule;

  const mainModule = typeof (Deno as { mainModule?: string }).mainModule === "string"
    ? (Deno as { mainModule?: string }).mainModule!
    : "";
  const isDenoCompiled = mainModule !== "" && !mainModule.endsWith(".ts");

  if (isDenoCompiled) {
    await import("#kreuzberg-wasm-glue");
    try {
      const kreuzbergUrl = import.meta.resolve("@kreuzberg/wasm");
      const pdfiumUrl = new URL("./pdfium.js", kreuzbergUrl).href;
      await import(pdfiumUrl);
    } catch {
      // Non-fatal: PDF extraction may be degraded but other formats work.
    }
  }

  await mod.initWasm?.();
  return mod;
}
