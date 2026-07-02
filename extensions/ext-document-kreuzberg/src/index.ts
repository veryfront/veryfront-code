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
import { loadKreuzberg, loadKreuzbergNative } from "./kreuzberg.ts";
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

export interface KreuzbergDocumentExtractorDeps {
  isDenoRuntime?: boolean;
  loadNativeKreuzberg?: () => Promise<KreuzbergExtractor>;
  extractInWorkerDeno?: typeof extractInWorkerDeno;
}

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().split(";")[0]?.trim() === "application/pdf";
}

function isNativeKreuzbergUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("@kreuzberg/node") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("Cannot find module") ||
    message.includes("Cannot find package") ||
    message.includes("Module not found");
}

async function extractWithNativeKreuzberg(
  buffer: ArrayBuffer,
  mimeType: string,
  loadNative: () => Promise<KreuzbergExtractor>,
): Promise<string> {
  const { extractBytes } = await loadNative();
  const result = await extractBytes(new Uint8Array(buffer), mimeType);
  return result.content;
}

export class KreuzbergDocumentExtractor implements DocumentExtractor {
  constructor(private readonly deps: KreuzbergDocumentExtractorDeps = {}) {}

  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  async extractInWorker(buffer: ArrayBuffer, mimeType: string): Promise<string> {
    const isDenoRuntime = this.deps.isDenoRuntime ?? isDeno;
    const extractWithWorker = this.deps.extractInWorkerDeno ?? extractInWorkerDeno;

    // Node/Bun extract in-process via @kreuzberg/node. Deno keeps the isolated
    // Worker fallback, but PDFs first try the native extractor because the WASM
    // PDF path can hang on valid large manuals.
    if (!isDenoRuntime) {
      const { extractBytes } = await loadKreuzberg();
      const result = await extractBytes(new Uint8Array(buffer), mimeType);
      return result.content;
    }

    if (isPdfMimeType(mimeType)) {
      try {
        return await extractWithNativeKreuzberg(
          buffer,
          mimeType,
          this.deps.loadNativeKreuzberg ?? loadKreuzbergNative,
        );
      } catch (error) {
        if (!isNativeKreuzbergUnavailable(error)) throw error;
      }
    }

    return extractWithWorker(buffer, mimeType);
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
