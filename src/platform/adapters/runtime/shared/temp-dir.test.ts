import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
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

  it("rejects prefixes that can escape or reshape the temp root", async () => {
    for (const prefix of ["", "../escape-", "nested/path-", "nested\\path-", ".", "..", "bad\0-"]) {
      await assertRejects(() => makeNodeTempDir(prefix), VeryfrontError);
    }
    await assertRejects(() => makeNodeTempDir("x".repeat(129)), VeryfrontError);
  });

  it("creates a direct child of the canonical temp root", async () => {
    const { dirname } = await import("node:path");
    const { realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await makeNodeTempDir("contained-");
    try {
      assertEquals(dirname(await realpath(dir)), await realpath(tmpdir()));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
