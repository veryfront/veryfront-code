import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the portable testing module itself.
 *
 * This file verifies that the testing compat layer works correctly.
 */

import { assert, assertEquals, assertExists, assertRejects, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { makeTempDir, makeTempFile, withTempDir } from "./deno-compat.ts";
import { remove, stat } from "#veryfront/compat/fs.ts";

/**
 * Run `fn` and report whether it failed, using `assert` as the only oracle.
 *
 * The negative direction of an assertion cannot be pinned with the same helper
 * it exercises, so the failing case is observed directly instead.
 */
function assertFails(fn: () => unknown, msg: string): void {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }

  assert(failed, msg);
}

describe("testing/assert", () => {
  it("exposes initBdd from the direct BDD entrypoint", async () => {
    const bddModule = await import("#veryfront/testing/bdd.ts");
    assertEquals(typeof bddModule.initBdd, "function");
  });

  it("assertEquals works with primitives", () => {
    assertEquals(1, 1);
    assertEquals("hello", "hello");
    assertEquals(true, true);
  });

  it("assertEquals works with objects", () => {
    assertEquals({ a: 1 }, { a: 1 });
    assertEquals([1, 2, 3], [1, 2, 3]);
  });

  it("assertExists detects defined values", () => {
    assertExists("hello");
    assertExists(0);
    assertExists(false);
    assertExists({});
  });

  it("assertThrows catches errors", () => {
    assertThrows(() => {
      throw new Error("test error");
    });
  });

  it("assertThrows validates error type", () => {
    assertThrows(
      () => {
        throw new TypeError("type error");
      },
      TypeError,
    );
  });

  it("assertions fail when the condition does not hold", () => {
    assertFails(() => assertEquals(1, 2), "assertEquals must throw on unequal primitives");
    assertFails(
      () => assertEquals({ a: 1 }, { a: 2 }),
      "assertEquals must throw on unequal objects",
    );
    assertFails(() => assertExists(null), "assertExists must throw on null");
    assertFails(() => assertExists(undefined), "assertExists must throw on undefined");
    assertFails(() => assert(false), "assert must throw on a falsy expression");
    assertFails(
      () => assertThrows(() => {}),
      "assertThrows must report a function that never throws",
    );
    assertFails(
      () =>
        assertThrows(() => {
          throw new Error("x");
        }, TypeError),
      "assertThrows must report an error of the wrong type",
    );
  });

  it("assertRejects fails when the promise resolves", async () => {
    let failed = false;
    try {
      await assertRejects(() => Promise.resolve("no rejection"));
    } catch {
      failed = true;
    }

    assert(failed, "assertRejects must report a promise that never rejects");
  });
});

describe("testing/deno-compat", () => {
  it("makeTempDir creates a directory", async () => {
    const tempDir = await makeTempDir({ prefix: "test-" });
    assertEquals(
      (await stat(tempDir)).isDirectory,
      true,
      "makeTempDir must create a directory",
    );

    await remove(tempDir, { recursive: true });
  });

  it("makeTempFile creates a file", async () => {
    const tempFile = await makeTempFile({ prefix: "test-", suffix: ".txt" });
    assertEquals(
      (await stat(tempFile)).isFile,
      true,
      "makeTempFile must create a regular file",
    );
    assertEquals(
      tempFile.endsWith(".txt"),
      true,
      "the requested suffix must be applied",
    );

    await remove(tempFile);
  });

  it("withTempDir provides temp directory and cleans up", async () => {
    let capturedPath = "";

    await withTempDir(async (tempDir) => {
      capturedPath = tempDir;
      assertExists(tempDir);

      const statResult = await stat(tempDir);
      assertEquals(statResult.isDirectory, true);
    });

    try {
      await stat(capturedPath);
    } catch (error) {
      // Expected: directory no longer exists
      // Deno throws "NotFound", Node.js throws "Error" with ENOENT code
      const err = error as Error & { code?: string };
      assert(
        err.name === "NotFound" || err.code === "ENOENT",
        `Expected NotFound or ENOENT error, got: ${err.name} / ${err.code}`,
      );
      return;
    }

    throw new Error("Directory should have been removed");
  });
});
