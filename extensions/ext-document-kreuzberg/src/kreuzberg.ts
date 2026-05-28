/**
 * Shared kreuzberg loader for the ext-document-kreuzberg extension.
 *
 * Used by both `KreuzbergDocumentExtractor.importKreuzberg()` (direct calls
 * from Node/Bun) and the extension's upload-extraction worker (Deno isolate).
 * Centralising the loader keeps the compiled-binary WASM glue + pdfium
 * pre-import dance in one place.
 *
 * @module extensions/ext-document-kreuzberg/kreuzberg
 */

import type { KreuzbergExtractor } from "veryfront/extensions/compat";
import { isDeno } from "./runtime.ts";

type KreuzbergModule = {
  initWasm?: () => Promise<void>;
  extractBytes: (
    data: Uint8Array,
    mimeType: string,
  ) => Promise<{ content: string }>;
};

// deno-lint-ignore no-explicit-any
async function loadKreuzbergNode(): Promise<any> {
  try {
    return await import("@kreuzberg/node");
  } catch (error) {
    if (!isMissingPackageError(error)) throw error;
    throw new Error(
      'Document extraction on Node requires the optional package "@kreuzberg/node". ' +
        "Install @kreuzberg/node@^4.4.2 or disable document extraction.",
    );
  }
}

export async function loadKreuzberg(): Promise<KreuzbergExtractor> {
  // Node/Bun load the native @kreuzberg/node; only a real Deno runtime uses the
  // WASM build. See ./runtime.ts for why a bare `Deno` check is unreliable here.
  if (!isDeno) {
    return loadKreuzbergNode();
  }

  const mod = await importKreuzbergWasm();

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

async function importKreuzbergWasm(): Promise<KreuzbergModule> {
  try {
    return await import("@kreuzberg/wasm") as unknown as KreuzbergModule;
  } catch (error) {
    if (!isMissingPackageError(error)) throw error;
    throw new Error(
      'Document extraction on Deno requires the optional package "@kreuzberg/wasm". ' +
        "Install @kreuzberg/wasm@4.5.2 or disable document extraction.",
    );
  }
}

function isMissingPackageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Module not found");
}
