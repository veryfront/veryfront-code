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
import { isDeno } from "./runtime.ts";

/** Maximum time to wait for document text extraction before aborting. */
const EXTRACTION_TIMEOUT_MS = 30_000;

function extractInWorkerDeno(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // The worker ships as raw TypeScript in the compiled binary and from source
    // (where `compile-binary.ts` force-includes it), but as transpiled JS in the
    // npm package consumed via `deno run npm:veryfront`. Pick the sibling that
    // matches whichever build is executing this module.
    const workerFile = import.meta.url.endsWith(".ts")
      ? "./upload-extraction-worker.ts"
      : "./upload-extraction-worker.js";
    const workerUrl = new URL(workerFile, import.meta.url);
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
    // Only a real Deno runtime gets the isolated Worker; Node/Bun extract
    // in-process via @kreuzberg/node. See ./runtime.ts for why a bare `Deno`
    // check is unreliable in the dnt npm build.
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
    contracts: {
      provides: ["DocumentExtractor"],
    },
    capabilities: [
      { type: "fs:read" },
    ],

    setup(ctx) {
      ctx.provide("DocumentExtractor", extractor);
      ctx.logger.info("[ext-document-kreuzberg] document extraction registered");
    },
  };
};

export default extDocumentKreuzberg;
