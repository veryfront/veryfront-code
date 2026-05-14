/**
 * ext-document-kreuzberg: document text extraction for Veryfront.
 *
 * Provides the `DocumentExtractor` contract via kreuzberg. Deno extraction can
 * run inside an isolated Worker so a hung WASM call does not block the server.
 *
 * @module extensions/ext-document-kreuzberg
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { DocumentExtractor, KreuzbergExtractor } from "veryfront/extensions/compat";
import { loadKreuzberg } from "./kreuzberg.ts";

/** Maximum time to wait for document text extraction before aborting. */
const EXTRACTION_TIMEOUT_MS = 30_000;

function extractInWorkerDeno(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Static URL literal so `deno compile` traces the worker script into
    // the binary's embedded module graph.
    const workerUrl = new URL("./upload-extraction-worker.ts", import.meta.url);
    const worker = new Worker(workerUrl, { type: "module" });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          `Text extraction timed out after ${
            EXTRACTION_TIMEOUT_MS / 1000
          }s. The file may be corrupted or unsupported`,
        ),
      );
    }, EXTRACTION_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const { content, error } = event.data as { content?: string; error?: string };
      if (error) {
        reject(new Error(error));
      } else {
        resolve(content ?? "");
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(`Text extraction worker failed: ${event.message ?? "unknown"}`));
    };

    worker.postMessage({ buffer, mimeType }, [buffer]);
  });
}

export class KreuzbergDocumentExtractor implements DocumentExtractor {
  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  async extractInWorker(buffer: ArrayBuffer, mimeType: string): Promise<string> {
    const isDeno = typeof Deno !== "undefined";
    if (!isDeno) {
      const { extractBytes } = await loadKreuzberg();
      const result = await extractBytes(new Uint8Array(buffer), mimeType);
      return result.content;
    }
    return extractInWorkerDeno(buffer, mimeType);
  }
}

const extDocumentKreuzberg: ExtensionFactory = () => {
  const extractor = new KreuzbergDocumentExtractor();

  return {
    name: "ext-document-kreuzberg",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "DocumentExtractor" },
      { type: "fs:read" },
    ],

    setup(ctx) {
      ctx.provide("DocumentExtractor", extractor);
      ctx.logger.info("[ext-document-kreuzberg] document extraction registered");
    },
  };
};

export default extDocumentKreuzberg;
