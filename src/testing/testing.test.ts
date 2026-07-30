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
  assertMatch,
  assertObjectMatch,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "./assert.ts";
import { describe, it } from "./bdd.ts";
import {
  getEnv,
  makeTempDir,
  makeTempFile,
  waitFor,
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

  it("keeps equality semantics consistent across runtimes", () => {
    const nullPrototypeRecord = Object.assign(Object.create(null) as Record<string, number>, {
      value: 1,
    });

    assertEquals(-0, 0);
    assertEquals(nullPrototypeRecord, { value: 1 });
  });

  it("matches cyclic object subsets without overflowing the stack", () => {
    const actual: { value: number; self?: unknown } = { value: 1 };
    actual.self = actual;
    const expected: { value: number; self?: unknown } = { value: 1 };
    expected.self = expected;

    assertObjectMatch(actual, expected);
  });

  it("matches repeated object references by structure rather than alias identity", () => {
    const shared = { value: 1, extra: true };

    assertObjectMatch(
      { first: shared, second: shared },
      { first: { value: 1 }, second: { value: 1 } },
    );
  });

  it("rejects mismatched Map values consistently across runtimes", () => {
    assertThrows(
      () =>
        assertObjectMatch(
          { values: new Map([["created", new Date(0)]]) },
          { values: new Map([["created", new Date(1)]]) },
        ),
      Error,
    );

    assertObjectMatch(
      { values: new Map([["created", new Date(0)]]) },
      { values: new Map([["created", new Date(0)]]) },
    );
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

  it("does not mutate stateful regular expressions", () => {
    const expression = /value/g;
    expression.lastIndex = 3;

    assertMatch("value", expression);
    assertEquals(expression.lastIndex, 3);
    assertThrows(() => assertMatch("other", expression), Error, "to match");
    assertEquals(expression.lastIndex, 3);
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

  it("does not sleep past the polling deadline when the interval is longer", async () => {
    const startedAt = performance.now();

    await assertRejects(
      () =>
        waitFor(() => false, {
          timeout: 20,
          interval: 1500,
          message: "deadline regression",
        }),
      Error,
      "deadline regression",
    );

    const elapsedMs = performance.now() - startedAt;
    assert(
      elapsedMs < 750,
      `Expected the polling deadline near 20ms, but it took ${Math.round(elapsedMs)}ms`,
    );
  });

  it("does not invoke the predicate again after the polling deadline", async () => {
    let calls = 0;

    await assertRejects(
      () =>
        waitFor(() => ++calls === 2, {
          timeout: 20,
          interval: 1500,
          message: "post-deadline predicate regression",
        }),
      Error,
      "post-deadline predicate regression",
    );

    assertEquals(calls, 1);
  });
});
