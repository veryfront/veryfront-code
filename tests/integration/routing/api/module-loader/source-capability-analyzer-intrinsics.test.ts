import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  rewriteImportMetaLocations,
  rewriteUnboundCommonJsDynamicRequire,
} from "#veryfront/routing/api/module-loader/source-capability-analyzer.ts";

describe("source capability analyzer intrinsics", () => {
  it("uses captured JSON serialization when folding immutable require specifiers", async () => {
    const originalStringify = JSON.stringify;
    try {
      JSON.stringify = () => '"poisoned"';
      assertEquals(
        await rewriteUnboundCommonJsDynamicRequire(
          'const moduleName = "./dynamic.cjs";\nrequire(moduleName);',
          "__moduleRequire",
        ),
        'const moduleName = "./dynamic.cjs";\nrequire("./dynamic.cjs");',
      );
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it("uses captured JSON serialization for generated module locations", async () => {
    const originalStringify = JSON.stringify;
    try {
      JSON.stringify = () => '"poisoned"; globalThis.injected = true; "';
      assertEquals(
        await rewriteImportMetaLocations(
          "const url = import.meta.url;",
          "file:///project/lib/helper.ts",
        ),
        'const url = "file:///project/lib/helper.ts";',
      );
    } finally {
      JSON.stringify = originalStringify;
    }
  });
});
