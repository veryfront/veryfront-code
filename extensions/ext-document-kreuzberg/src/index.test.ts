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
import factory, { KreuzbergDocumentExtractor } from "./index.ts";

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
});
