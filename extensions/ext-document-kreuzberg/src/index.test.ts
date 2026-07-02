/**
 * ext-document-kreuzberg extension tests.
 *
 * Exercises the extension factory lifecycle without loading kreuzberg.
 *
 * @module extensions/ext-document-kreuzberg/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import factory, {
  EXTRACTION_TIMEOUT_MS,
  KreuzbergDocumentExtractor,
  type KreuzbergDocumentExtractorDeps,
} from "./index.ts";

function silentLogger(): ExtensionLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function buildCtx(
  provides: Map<string, unknown>,
  logger: ExtensionLogger = silentLogger(),
): ExtensionContext {
  return {
    get: <T>(name: string) => provides.get(name) as T | undefined,
    require: <T>(name: string) => {
      const impl = provides.get(name);
      if (impl === undefined) throw new Error(`missing ${name}`);
      return impl as T;
    },
    provide: <T>(name: string, impl: T) => {
      provides.set(name, impl);
    },
    config: {},
    logger,
  };
}

describe("ext-document-kreuzberg extension", () => {
  it("declares the expected name and contract", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-document-kreuzberg");
    assertEquals(ext.contracts?.provides, ["DocumentExtractor"]);
  });

  it("registers DocumentExtractor on setup", () => {
    const ext = factory();
    const provides = new Map<string, unknown>();
    const ctx = buildCtx(provides);

    ext.setup!(ctx as never);

    const extractor = provides.get("DocumentExtractor") as KreuzbergDocumentExtractor;
    assertExists(extractor);
    assertEquals(typeof extractor.importKreuzberg, "function");
    assertEquals(typeof extractor.extractInWorker, "function");
  });

  it("uses a two minute timeout for fallback worker extraction", () => {
    assertEquals(EXTRACTION_TIMEOUT_MS, 120_000);
  });

  it("uses native extraction for PDFs in Deno before falling back to the WASM worker", async () => {
    const calls: Array<{ bytes: string; mimeType: string }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      loadNativeKreuzberg: async () => ({
        extractBytes: async (data, mimeType) => {
          calls.push({ bytes: new TextDecoder().decode(data), mimeType });
          return { content: "native pdf text" };
        },
      }),
      extractInWorkerDeno: async () => {
        throw new Error("worker should not be used for PDFs when native extraction is available");
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf");

    assertEquals(content, "native pdf text");
    assertEquals(calls, [{ bytes: "%PDF-1.4\n", mimeType: "application/pdf" }]);
  });

  it("falls back to the Deno worker when native PDF extraction is unavailable", async () => {
    const workerCalls: Array<{ bytes: string; mimeType: string }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      loadNativeKreuzberg: async () => {
        throw new Error("Cannot find native binding", {
          cause: new Error("Cannot find module '@kreuzberg/node-linux-x64'"),
        });
      },
      extractInWorkerDeno: async (buffer, mimeType) => {
        workerCalls.push({ bytes: new TextDecoder().decode(buffer), mimeType });
        return "worker pdf text";
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf");

    assertEquals(content, "worker pdf text");
    assertEquals(workerCalls, [{ bytes: "%PDF-1.4\n", mimeType: "application/pdf" }]);
  });
});
