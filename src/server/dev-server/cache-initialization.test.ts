import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";

/**
 * The dev server decides once, at startup, whether to run the distributed-cache
 * initializers. Without that call the SSR module cache gateway never resolves,
 * the loader skips both disk reads and writes, and every restart is cold again.
 * Gating on the explicit disk configuration alone reintroduces exactly that, so
 * the gate must stay the broader `isPersistentLocalCacheEnabled()`.
 */
describe("dev server cache initialization gate", () => {
  it("runs the cache initializers whenever a persistent local cache exists", async () => {
    const source = await readTextFile(fromFileUrl(new URL("./server.ts", import.meta.url)));

    const gate = "if (isPersistentLocalCacheEnabled()) {";
    assertStringIncludes(source, gate);
    const gatedBlock = source.slice(source.indexOf(gate));
    const gatedBody = gatedBlock.slice(0, gatedBlock.indexOf("\n    }\n"));
    assertStringIncludes(
      gatedBody,
      "initializeDistributedCaches(defaultDistributedCacheInitializers)",
      "the persistent-cache gate must actually run the default distributed cache initializers",
    );
    assertEquals(
      source.includes("isDiskCacheConfigured"),
      false,
      "the dev server must not gate cache initialization on the explicit disk configuration alone",
    );
  });
});
