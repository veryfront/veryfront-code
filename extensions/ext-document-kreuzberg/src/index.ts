/**
 * ext-document-kreuzberg: document text extraction for Veryfront.
 *
 * Provides the `DocumentExtractor` contract via kreuzberg. Deno extraction can
 * run inside an isolated Worker so a hung WASM call does not block the server.
 *
 * @module extensions/ext-document-kreuzberg
 */

import type { ExtensionFactory, ExtensionLogger } from "veryfront/extensions";
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgressEvent,
  DocumentExtractor,
  KreuzbergExtractor,
} from "veryfront/extensions/compat";
import { isMissingPackageError, loadKreuzberg, loadKreuzbergNative } from "./kreuzberg.ts";
import { extractionConfigForMimeType } from "./extraction-config.ts";
import { isDeno } from "./runtime.ts";

export const NATIVE_PROGRESS_IDLE_TIMEOUT_MS = 120_000;
export const NATIVE_PROGRESS_HARD_TIMEOUT_MS = 10 * 60_000;
/** Maximum time to wait for fallback worker extraction before aborting. */
export const EXTRACTION_TIMEOUT_MS = NATIVE_PROGRESS_HARD_TIMEOUT_MS;

function extractInWorkerDeno(
  buffer: ArrayBuffer,
  mimeType: string,
  options: DocumentExtractionOptions = {},
): Promise<string> {
  options.abortSignal?.throwIfAborted();
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
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortSignal = options.abortSignal;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      abortSignal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      fail(
        abortSignal?.reason ??
          new DOMException("The extraction was aborted", "AbortError"),
      );
    };

    timer = setTimeout(() => {
      fail(
        new Error(
          `Text extraction timed out after ${
            EXTRACTION_TIMEOUT_MS / 1000
          }s. The file may be corrupted or unsupported`,
        ),
      );
    }, EXTRACTION_TIMEOUT_MS);
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      const { content, error } = event.data as { content?: string; error?: string };
      if (error) {
        reject(new Error(error));
      } else {
        resolve(content ?? "");
      }
    };

    worker.onerror = (event) => {
      fail(new Error(`Text extraction worker failed: ${event.message ?? "unknown"}`));
    };

    worker.postMessage({ buffer, mimeType }, [buffer]);
  });
}

export interface KreuzbergDocumentExtractorDeps {
  isDenoRuntime?: boolean;
  loadNativeKreuzberg?: () => Promise<KreuzbergExtractor>;
  extractInWorkerDeno?: typeof extractInWorkerDeno;
  extractWithNativeProgressDeno?: typeof extractWithNativeProgressDeno;
  logger?: Pick<ExtensionLogger, "warn">;
}

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().split(";")[0]?.trim() === "application/pdf";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function isNativeProgressMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "application/pdf" ||
    normalized === "application/vnd.ms-powerpoint" ||
    normalized === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

async function extractWithNativeKreuzberg(
  buffer: ArrayBuffer,
  mimeType: string,
  loadNative: () => Promise<KreuzbergExtractor>,
): Promise<string> {
  const { extractBytes } = await loadNative();
  const result = await extractBytes(
    new Uint8Array(buffer),
    mimeType,
    extractionConfigForMimeType(mimeType),
  );
  return result.content;
}

type NativeProgressWorkerResponse =
  | { type: "done"; content: string }
  | { type: "error"; error: string }
  | { type: "progress"; event: DocumentExtractionProgressEvent };

function warningDetails(mimeType: string, error: unknown): Record<string, string> {
  return {
    mimeType,
    error: error instanceof Error ? error.message : String(error),
  };
}

function extractWithNativeProgressDeno(
  buffer: ArrayBuffer,
  mimeType: string,
  options: DocumentExtractionOptions,
): Promise<string> {
  options.abortSignal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const workerFile = import.meta.url.endsWith(".ts")
      ? "./native-progress-extraction-worker.ts"
      : "./native-progress-extraction-worker.js";
    const workerUrl = new URL(workerFile, import.meta.url);
    const worker = new Worker(workerUrl, { type: "module" });
    const idleTimeoutMs = options.idleTimeoutMs ?? NATIVE_PROGRESS_IDLE_TIMEOUT_MS;
    const hardTimeoutMs = options.hardTimeoutMs ?? NATIVE_PROGRESS_HARD_TIMEOUT_MS;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearIdleTimer = () => {
      if (!idleTimer) return;
      clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    const cleanup = () => {
      settled = true;
      clearIdleTimer();
      clearTimeout(hardTimer);
      options.abortSignal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      fail(
        options.abortSignal?.reason instanceof Error
          ? options.abortSignal.reason
          : new DOMException("The extraction was aborted", "AbortError"),
      );
    };
    const resetIdleTimer = () => {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        fail(
          new Error(
            `Text extraction made no progress for ${idleTimeoutMs / 1000}s. ` +
              "The file may be corrupted or unsupported",
          ),
        );
      }, idleTimeoutMs);
    };
    const hardTimer = setTimeout(() => {
      fail(
        new Error(
          `Text extraction exceeded the hard timeout after ${hardTimeoutMs / 1000}s. ` +
            "The file may be corrupted or unsupported",
        ),
      );
    }, hardTimeoutMs);

    resetIdleTimer();
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = async (event: MessageEvent<NativeProgressWorkerResponse>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === "progress") {
        clearIdleTimer();
        try {
          await options.onProgress?.(message.event);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (!settled) resetIdleTimer();
        return;
      }
      if (message.type === "error") {
        fail(new Error(message.error));
        return;
      }

      cleanup();
      resolve(message.content);
    };

    worker.onerror = (event) => {
      fail(new Error(`Text extraction worker failed: ${event.message ?? "unknown"}`));
    };

    const requestBuffer = buffer.slice(0);
    worker.postMessage({ buffer: requestBuffer, mimeType }, [requestBuffer]);
  });
}

export class KreuzbergDocumentExtractor implements DocumentExtractor {
  constructor(private readonly deps: KreuzbergDocumentExtractorDeps = {}) {}

  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  async extractInWorker(
    buffer: ArrayBuffer,
    mimeType: string,
    options: DocumentExtractionOptions = {},
  ): Promise<string> {
    options.abortSignal?.throwIfAborted();
    const isDenoRuntime = this.deps.isDenoRuntime ?? isDeno;
    const extractWithWorker = this.deps.extractInWorkerDeno ?? extractInWorkerDeno;

    // Node/Bun extract in-process via @kreuzberg/node. Deno keeps the isolated
    // Worker fallback, but PDFs first try the native extractor because the WASM
    // PDF path can hang on valid large manuals.
    if (!isDenoRuntime) {
      const { extractBytes } = await loadKreuzberg();
      options.abortSignal?.throwIfAborted();
      const result = await extractBytes(
        new Uint8Array(buffer),
        mimeType,
        extractionConfigForMimeType(mimeType),
      );
      options.abortSignal?.throwIfAborted();
      return result.content;
    }

    if (options.onProgress && isNativeProgressMimeType(mimeType)) {
      try {
        return await (this.deps.extractWithNativeProgressDeno ?? extractWithNativeProgressDeno)(
          buffer,
          mimeType,
          options,
        );
      } catch (error) {
        if (options.abortSignal?.aborted) throw error;
        // Keep progress opportunistic: if page/slide extraction cannot handle a
        // document, fall back to the previous opaque extraction path.
        const message =
          "[ext-document-kreuzberg] native progress extraction failed; falling back to opaque extraction";
        const details = warningDetails(mimeType, error);
        if (this.deps.logger) {
          this.deps.logger.warn(message, details);
        } else {
          console.warn(message, details);
        }
      }
    }

    if (isPdfMimeType(mimeType)) {
      try {
        const content = await extractWithNativeKreuzberg(
          buffer,
          mimeType,
          this.deps.loadNativeKreuzberg ?? loadKreuzbergNative,
        );
        options.abortSignal?.throwIfAborted();
        return content;
      } catch (error) {
        if (options.abortSignal?.aborted) throw error;
        if (!isMissingPackageError(error)) throw error;
      }
    }

    return extractWithWorker(buffer, mimeType, options);
  }
}

const extDocumentKreuzberg: ExtensionFactory = () => {
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
      const extractor = new KreuzbergDocumentExtractor({ logger: ctx.logger });
      ctx.provide("DocumentExtractor", extractor);
      ctx.logger.debug("[ext-document-kreuzberg] document extraction registered");
    },
  };
};

export default extDocumentKreuzberg;
