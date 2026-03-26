/**
 * Worker script for kreuzberg document text extraction.
 *
 * Runs `extractBytes` in an isolated Worker thread so that long-running or
 * hung WASM operations cannot block the main server event loop.
 *
 * @module embedding
 */

/// <reference lib="deno.worker" />

import { importKreuzberg } from "#veryfront/platform/compat/opaque-deps.ts";

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
    const { extractBytes } = await importKreuzberg();
    const result = await extractBytes(new Uint8Array(buffer), mimeType);
    self.postMessage({ content: result.content } satisfies ExtractResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: message } satisfies ExtractResponse);
  }
};
