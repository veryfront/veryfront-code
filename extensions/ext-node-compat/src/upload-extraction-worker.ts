/**
 * Worker script for kreuzberg document text extraction.
 *
 * Runs `extractBytes` in an isolated Worker thread so that long-running or
 * hung WASM operations cannot block the main server event loop.
 *
 * Lives inside the ext-node-compat extension (not core) so that the
 * `@kreuzberg/wasm` import and `#kreuzberg-wasm-glue` pre-import resolve
 * through the extension's own import map. Deno worker isolates do not
 * share the main-thread NodeCompat contract registry, so the worker
 * calls into the shared `loadKreuzberg` helper directly rather than
 * round-tripping through the registry.
 *
 * @module extensions/ext-node-compat/upload-extraction-worker
 */

/// <reference lib="deno.worker" />

import { loadKreuzberg } from "./kreuzberg.ts";

interface ExtractRequest {
  buffer: ArrayBuffer;
  mimeType: string;
}

interface ExtractResponse {
  content?: string;
  error?: string;
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  try {
    const { buffer, mimeType } = event.data;
    const { extractBytes } = await loadKreuzberg();
    const result = await extractBytes(new Uint8Array(buffer), mimeType);
    self.postMessage({ content: result.content } satisfies ExtractResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: message } satisfies ExtractResponse);
  }
};
