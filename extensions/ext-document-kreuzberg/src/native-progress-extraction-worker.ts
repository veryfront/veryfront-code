/**
 * Native document extraction Worker with real progress events.
 *
 * Thin Worker wrapper over `./native-extraction.ts`. NOTE: a Worker is an
 * in-process isolate, so it cannot contain native parser crashes — the host
 * extraction path uses `./native-extraction-process.ts` (a subprocess) instead.
 * This wrapper remains for in-isolate consumers and tests that only need the
 * page/slide progress protocol.
 *
 * @module extensions/ext-document-kreuzberg/native-progress-extraction-worker
 */

/// <reference lib="deno.worker" />

import type { DocumentExtractionProgressEvent } from "veryfront/extensions/compat";
import { extractNativeDocument } from "./native-extraction.ts";

interface ExtractRequest {
  buffer: ArrayBuffer;
  mimeType: string;
}

type ExtractResponse =
  | { type: "done"; content: string }
  | { type: "error"; error: string }
  | { type: "progress"; event: DocumentExtractionProgressEvent };

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  if (event.origin && event.origin !== self.location.origin) {
    self.postMessage(
      {
        type: "error",
        error: "Rejected document extraction request from invalid origin",
      } satisfies ExtractResponse,
    );
    return;
  }

  try {
    const { buffer, mimeType } = event.data;
    const content = await extractNativeDocument(buffer, mimeType, {
      mode: "progress",
      emitProgress: (progressEvent) => {
        self.postMessage({ type: "progress", event: progressEvent } satisfies ExtractResponse);
      },
    });
    self.postMessage({ type: "done", content } satisfies ExtractResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: "error", error: message } satisfies ExtractResponse);
  }
};
