import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the portable testing module itself.
 *
 * This file verifies that the testing compat layer works correctly.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "./assert.ts";
import { describe, it } from "./bdd.ts";
import {
  getEnv,
  makeTempDir,
  makeTempFile,
  withEnv,
  withTempDir,
  withTempFile,
} from "./deno-compat.ts";
import { mkdir, remove, stat, writeTextFile } from "#veryfront/compat/fs.ts";

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

  it("assertThrows returns the captured error across runtimes", () => {
    const expected = new TypeError("captured throw");
    const actual = assertThrows(
      () => {
        throw expected;
      },
      TypeError,
      "captured throw",
    );

    assertStrictEquals(actual, expected);
  });

  it("assertRejects returns the captured rejection across runtimes", async () => {
    const expected = new TypeError("captured rejection");
    const actual = await assertRejects(
      () => Promise.reject(expected),
      TypeError,
      "captured rejection",
    );

    assertStrictEquals(actual, expected);
  });

  it("preserves custom failure messages for throw and rejection assertions", async () => {
    assertThrows(
      () => assertThrows(() => undefined, TypeError, undefined, "custom throw assertion"),
      Error,
      "custom throw assertion",
    );
    await assertRejects(
      () =>
        assertRejects(
          async () => undefined,
          TypeError,
          undefined,
          "custom rejection assertion",
        ),
      Error,
      "custom rejection assertion",
    );
  });
});

describe("testing/deno-compat", () => {
  it("makeTempDir creates a directory", async () => {
    const tempDir = await makeTempDir({ prefix: "test-" });
    assertExists(tempDir);

    await remove(tempDir, { recursive: true });
  });

  it("makeTempFile creates a file", async () => {
    const tempFile = await makeTempFile({ prefix: "test-", suffix: ".txt" });
    assertExists(tempFile);

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

  it("creates concurrent temp files atomically and rejects path separators", async () => {
    const files = await Promise.all(
      Array.from({ length: 32 }, () => makeTempFile({ prefix: "vf-", suffix: ".tmp" })),
    );

    try {
      assertEquals(new Set(files).size, files.length);
      await Promise.all(files.map(async (file) => assertEquals((await stat(file)).isFile, true)));
    } finally {
      await Promise.all(files.map((file) => remove(file)));
    }

    await assertRejects(
      () => makeTempFile({ prefix: "../escape-" }),
      Error,
      "prefix or suffix",
    );
  });

  it("surfaces temp-file cleanup failures", async () => {
    let tempPath = "";
    try {
      await assertRejects(
        () =>
          withTempFile(async (file) => {
            tempPath = file;
            await remove(file);
            await mkdir(file);
            await writeTextFile(`${file}/occupied`, "keep directory non-empty");
          }),
        Error,
        "temporary file cleanup failed",
      );
    } finally {
      if (tempPath) await remove(tempPath, { recursive: true });
    }
  });

  it("isolates concurrent withEnv scopes", async () => {
    const key = "VF_TEST_CONCURRENT_WITH_ENV";
    const original = getEnv(key);
    let ready = 0;
    let release: (() => void) | undefined;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });

    await Promise.all(
      ["left", "right"].map((value) =>
        withEnv({ [key]: value }, async () => {
          ready++;
          if (ready === 2) release?.();
          await bothReady;
          assertEquals(getEnv(key), value);
          assertEquals(process.env[key], value);
        })
      ),
    );

    assertEquals(getEnv(key), original);
  });
});
