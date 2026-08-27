import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  rewriteUnboundCommonJsDynamicRequire,
} from "#veryfront/routing/api/module-loader/source-capability-analyzer.ts";

it("rewrites dynamic CommonJS loads without mutable string intrinsics", async () => {
  const source = "const name = globalThis.dynamicName; require(name);";
  const expected = "const name = globalThis.dynamicName; __moduleRequire(name);";
  // Load the host-owned parser before simulating tenant prototype pollution;
  // this test isolates the analyzer's intrinsics from extension startup.
  assertEquals(await rewriteUnboundCommonJsDynamicRequire(source, "__moduleRequire"), expected);

  const originalIncludes = String.prototype.includes;
  try {
    String.prototype.includes = function () {
      throw new Error("poisoned includes");
    };
    assertEquals(
      await rewriteUnboundCommonJsDynamicRequire(
        source,
        "__moduleRequire",
      ),
      expected,
    );
  } finally {
    String.prototype.includes = originalIncludes;
  }
});
