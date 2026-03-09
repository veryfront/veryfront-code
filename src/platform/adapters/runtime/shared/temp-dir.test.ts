import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeNodeTempDir } from "./temp-dir.ts";

describe("platform/adapters/runtime/shared/temp-dir", () => {
  it("should create a temp directory with the given prefix", async () => {
    const dir = await makeNodeTempDir("vf-test-");
    assertExists(dir);
    assertEquals(typeof dir, "string");
    assertEquals(dir.includes("vf-test-"), true);

    // Cleanup
    try {
      await Deno.remove(dir, { recursive: true });
    } catch (_) {
      /* expected: cleanup best-effort */
    }
  });

  it("should create unique directories on each call", async () => {
    const dir1 = await makeNodeTempDir("unique-");
    const dir2 = await makeNodeTempDir("unique-");
    assertEquals(dir1 !== dir2, true);

    // Cleanup
    try {
      await Deno.remove(dir1, { recursive: true });
      await Deno.remove(dir2, { recursive: true });
    } catch (_) {
      /* expected: cleanup best-effort */
    }
  });
});
