/**
 * Worker script for kreuzberg document text extraction.
 *
 * Runs `extractBytes` in an isolated Worker thread so that long-running or
 * hung WASM operations cannot block the main server event loop.
 *
 * Lives inside the ext-document-kreuzberg extension (not core) so that the
 * `@kreuzberg/wasm` import and `#kreuzberg-wasm-glue` pre-import resolve
 * through the extension's own import map. Deno worker isolates do not
 * share the main-thread contract registry, so the worker
 * calls into the shared `loadKreuzberg` helper directly rather than
 * round-tripping through the registry.
 *
 * @module extensions/ext-document-kreuzberg/upload-extraction-worker
 */

/// <reference lib="deno.worker" />

import { loadKreuzberg } from "./kreuzberg.ts";
import { extractionConfigForMimeType } from "./extraction-config.ts";

interface ExtractRequest {
  buffer: ArrayBuffer;
  mimeType: string;
}

interface ExtractResponse {
  content?: string;
  error?: string;
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  if (event.origin && event.origin !== self.location.origin) {
    self.postMessage(
      {
        error: "Rejected document extraction request from invalid origin",
      } satisfies ExtractResponse,
    );
    return;
  }

  try {
    const { buffer, mimeType } = event.data;
    const { extractBytes } = await loadKreuzberg();
    const result = await extractBytes(
      new Uint8Array(buffer),
      mimeType,
      extractionConfigForMimeType(mimeType),
    );
    self.postMessage({ content: result.content } satisfies ExtractResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: message } satisfies ExtractResponse);
  }
};
