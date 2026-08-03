import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeNodeTempDir } from "./temp-dir.ts";

describe("platform/adapters/runtime/shared/temp-dir", () => {
  it("should create a temp directory with the given prefix", async () => {
    const dir = await makeNodeTempDir("vf-test-");
    try {
      assertExists(dir);
      assertEquals(typeof dir, "string");
      assertEquals(dir.includes("vf-test-"), true);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("should create unique directories on each call", async () => {
    const dir1 = await makeNodeTempDir("unique-");
    const dir2 = await makeNodeTempDir("unique-");
    try {
      assertEquals(dir1 !== dir2, true);
    } finally {
      await Promise.all([
        Deno.remove(dir1, { recursive: true }),
        Deno.remove(dir2, { recursive: true }),
      ]);
    }
  });

  it("rejects path-bearing prefixes", async () => {
    for (const prefix of ["../escape-", "nested/temp-", String.raw`nested\temp-`, "bad\0"]) {
      await assertRejects(
        () => makeNodeTempDir(prefix),
        TypeError,
        "must not contain",
      );
    }
  });
});
