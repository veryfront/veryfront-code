import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertLogicalCaptureImports, captureResolvedModule } from "./captured-module.ts";
import { createModuleFetcherContext } from "./index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";
import { DENO_CONFIG_STUB_CODE } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts";
import { resolve, toFileUrl } from "#veryfront/compat/path";

describe("synthetic framework capture", () => {
  it("deduplicates immutable configuration without invoking dependency resolution", async () => {
    const capture = new ModuleSourceCapture({ maxEntries: 1, maxBytes: 1024 * 1024 });
    const adapter = createMockAdapter();
    const root = resolve("virtual-capture");
    const context = createModuleFetcherContext(root, adapter, root, "capture-test");
    const dependency = () => {
      throw new Error("Synthetic configuration has no dependencies");
    };
    const path = await captureResolvedModule(
      "_vf_modules/_veryfront/_deno-config.js",
      context,
      dependency,
      capture,
    );
    const repeated = await captureResolvedModule(
      "_vf_modules/_veryfront/_deno-config.js",
      context,
      dependency,
      capture,
    );
    assertEquals(path, repeated, "a synthetic module keeps one canonical identity");
    assertEquals(capture.take(), [{ url: toFileUrl(path!).href, source: DENO_CONFIG_STUB_CODE }]);
    assertEquals(adapter.fs.files.size, 0, "capture does not write an executable file");
  });

  it("reports an oversized synthetic module at the capture owner's boundary", async () => {
    const capture = new ModuleSourceCapture({ maxEntries: 1, maxBytes: 8 });
    const root = resolve("virtual-capture");
    await captureResolvedModule(
      "_vf_modules/_veryfront/_deno-config.js",
      createModuleFetcherContext(root, createMockAdapter(), root, "capture-test"),
      () => {
        throw new Error("Synthetic configuration has no dependencies");
      },
      capture,
    );
    assertThrows(() => capture.take(), Error, "byte budget");
  });
});

describe("logical capture imports", () => {
  it("allows inert file URL text and logical references", async () => {
    await assertLogicalCaptureImports(
      'const label = "file:///inert.mjs"; import "react"; import "node:fs"; import "/_vf_modules/page.js";',
      false,
    );
  });

  it("rejects raw file URLs even when relative project imports are enabled", async () => {
    for (
      const specifier of ["file:///uncaptured.mjs", "FILE:///uncaptured.mjs", "/uncaptured.mjs"]
    ) {
      await assertRejects(
        () => assertLogicalCaptureImports(`import ${JSON.stringify(specifier)};`, true),
        Error,
        "Unscoped file import",
      );
    }
  });

  it("requires a scoped module base for relative imports", async () => {
    await assertLogicalCaptureImports('export * from "../child.js";', true);
    await assertRejects(
      () => assertLogicalCaptureImports('export * from "../child.js";', false),
      Error,
      "Unscoped file import",
    );
  });
});
