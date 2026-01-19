/**
 * Tests for the portable testing module itself.
 *
 * This file verifies that the testing compat layer works correctly.
 */

import { assert, assertEquals, assertExists, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { makeTempDir, makeTempFile, withTempDir } from "./deno-compat.ts";
import { remove, stat } from "#veryfront/compat/fs.ts";

describe("testing/assert", () => {
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
});

// Temp file tests use the cross-runtime compat layer
describe("testing/deno-compat", () => {
  it("makeTempDir creates a directory", async () => {
    const tempDir = await makeTempDir({ prefix: "test-" });
    assertExists(tempDir);

    // Clean up using portable API
    await remove(tempDir, { recursive: true });
  });

  it("makeTempFile creates a file", async () => {
    const tempFile = await makeTempFile({ prefix: "test-", suffix: ".txt" });
    assertExists(tempFile);

    // Clean up using portable API
    await remove(tempFile);
  });

  it("withTempDir provides temp directory and cleans up", async () => {
    let capturedPath = "";

    await withTempDir(async (tempDir) => {
      capturedPath = tempDir;
      assertExists(tempDir);

      // Verify directory exists during callback using portable API
      const statResult = await stat(tempDir);
      assertEquals(statResult.isDirectory, true);
    });

    // Verify directory was cleaned up
    try {
      await stat(capturedPath);
      throw new Error("Directory should have been removed");
    } catch (error) {
      // Expected: directory no longer exists
      // Deno throws "NotFound", Node.js throws "Error" with ENOENT code
      const err = error as Error & { code?: string };
      assert(
        err.name === "NotFound" || err.code === "ENOENT",
        `Expected NotFound or ENOENT error, got: ${err.name} / ${err.code}`,
      );
    }
  });
});
