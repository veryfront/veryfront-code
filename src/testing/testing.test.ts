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
  assertInstanceOf,
  assertNotEquals,
  assertNotStrictEquals,
  assertObjectMatch,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "./assert.ts";
import { describe, it } from "./bdd.ts";
import {
  deleteEnv,
  getEnv,
  makeTempDir,
  makeTempDirWithOptions,
  makeTempFile,
  readTextFile,
  remove,
  setEnv,
  stat,
  waitFor,
  withEnv,
  withTempDir,
  withTempFile,
  writeTextFile,
} from "./deno-compat.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors";
import { dirname } from "#veryfront/platform/compat/index.ts";

describe("testing/assert", () => {
  it("passes test context through the portable BDD adapter", (context) => {
    assertEquals(typeof context?.name, "string");
  });

  it("adapts nested test steps on runtimes that expose them", async (context) => {
    if (isBun) return;
    assertEquals(typeof context?.step, "function");
    let childRan = false;
    await context?.step?.("portable child step", (childContext) => {
      assertEquals(typeof childContext?.name, "string");
      childRan = true;
    });
    assertEquals(childRan, true);
  });

  it("keeps the public testing entrypoints explicit", async () => {
    const testingModule = await import("./index.ts");
    assertEquals(Object.keys(testingModule).sort(), [
      "afterAll",
      "afterEach",
      "assert",
      "assertEquals",
      "assertExists",
      "assertGreater",
      "assertGreaterOrEqual",
      "assertInstanceOf",
      "assertLess",
      "assertLessOrEqual",
      "assertMatch",
      "assertNotEquals",
      "assertNotStrictEquals",
      "assertObjectMatch",
      "assertRejects",
      "assertStrictEquals",
      "assertStringIncludes",
      "assertThrows",
      "beforeAll",
      "beforeEach",
      "chmod",
      "createFileSystem",
      "cwd",
      "deepEquals",
      "delay",
      "deleteEnv",
      "describe",
      "env",
      "exists",
      "exit",
      "fail",
      "getArgs",
      "getEnv",
      "getTestTimeScale",
      "isAlreadyExistsError",
      "isBun",
      "isDeno",
      "isNode",
      "isNotFoundError",
      "it",
      "makeTempDir",
      "makeTempDirWithOptions",
      "makeTempFile",
      "mkdir",
      "readDir",
      "readFile",
      "readTextFile",
      "registerTestCleanup",
      "remove",
      "resetAllTestState",
      "safeStringify",
      "scaleMs",
      "setEnv",
      "stat",
      "test",
      "testDelay",
      "waitFor",
      "withEnv",
      "withTempDir",
      "withTempFile",
      "writeFile",
      "writeTextFile",
    ]);

    const bddModule = await import("./bdd.ts");
    assertEquals(Object.keys(bddModule).sort(), [
      "afterAll",
      "afterEach",
      "beforeAll",
      "beforeEach",
      "describe",
      "initBdd",
      "it",
      "test",
    ]);
  });

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

  it("reports assertion failures consistently across runtimes", () => {
    const error = assertThrows(() => assertEquals(1, 2), Error);
    assertEquals(error.name, "AssertionError");
  });

  it("strict equality uses Object.is semantics", () => {
    assertStrictEquals(Number.NaN, Number.NaN);
    assertNotStrictEquals(0, -0);
    assertThrows(() => assertStrictEquals(0, -0), Error);
    assertThrows(() => assertNotStrictEquals(Number.NaN, Number.NaN), Error);
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

  it("assertThrows preserves custom context when the error type is wrong", () => {
    const assertionError = assertThrows(
      () =>
        assertThrows(
          () => {
            throw new Error("wrong type");
          },
          TypeError,
          undefined,
          "custom context",
        ),
      Error,
    );

    assertStringIncludes(assertionError.message, "custom context");
  });

  it("assertThrows returns the thrown error", () => {
    const expected = new TypeError("returned error");
    const actual = assertThrows(() => {
      throw expected;
    }) as unknown;

    assertEquals(actual, expected);
  });

  it("assertRejects returns the rejection and rejects synchronous throws", async () => {
    const expected = new TypeError("returned rejection");
    const actual = await assertRejects(() => Promise.reject(expected));
    assertEquals(actual, expected);

    const assertionError = await assertRejects(
      () =>
        assertRejects(
          (() => {
            throw new Error("synchronous throw");
          }) as () => Promise<never>,
        ),
      Error,
      "Function throws when expected to reject",
    );
    assertInstanceOf(assertionError, Error);
  });

  it("assertObjectMatch compares symbol-keyed subsets", () => {
    const key = Symbol("key");
    assertObjectMatch({ [key]: { value: 1 }, extra: true }, { [key]: { value: 1 } });
    assertThrows(
      () => assertObjectMatch({ [key]: { value: 1 } }, { [key]: { value: 2 } }),
      Error,
    );
  });

  it("assertObjectMatch requires expected properties to exist directly on the value", () => {
    const inherited = Object.create({ value: 1 }) as Record<string, unknown>;
    assertThrows(
      () => assertObjectMatch(inherited, { value: 1 }),
      Error,
    );
  });

  it("assertObjectMatch preserves Map and Set membership semantics", () => {
    const setMember = { id: 1 };
    assertObjectMatch(
      { value: new Set([setMember, { id: 2 }]) },
      { value: new Set([setMember]) },
    );
    assertThrows(
      () => assertObjectMatch({ value: new Set([{ id: 1 }]) }, { value: new Set([{ id: 1 }]) }),
      Error,
    );

    const mapKey = { id: 1 };
    assertObjectMatch(
      { value: new Map([[mapKey, { name: "one", extra: true }]]) },
      { value: new Map([[mapKey, { name: "one" }]]) },
    );
    assertThrows(
      () =>
        assertObjectMatch(
          { value: new Map([[{ id: 1 }, { name: "one" }]]) },
          { value: new Map([[{ id: 1 }, { name: "one" }]]) },
        ),
      Error,
    );
  });

  it("assertObjectMatch compares Error details", () => {
    const error = new TypeError("failed", { cause: "reason" });
    assertObjectMatch(
      { error },
      { error },
    );
    assertThrows(
      () => assertObjectMatch({ error: new Error("first") }, { error: new Error("second") }),
      Error,
    );
  });

  it("assertObjectMatch checks non-enumerable properties and array holes", () => {
    const withHiddenValue = (value: number) =>
      Object.defineProperty({}, "hidden", { configurable: true, value });

    assertThrows(
      () =>
        assertObjectMatch(
          { value: withHiddenValue(1) },
          { value: withHiddenValue(2) },
        ),
      Error,
    );
    assertThrows(
      () => assertObjectMatch({ value: [1] }, { value: Array(1) }),
      Error,
    );
  });

  it("assertObjectMatch bounds deeply nested subset comparisons", () => {
    if (isDeno) return;

    const createNestedArray = () => {
      const root: unknown[] = [];
      let current = root;
      for (let depth = 0; depth < 600; depth++) {
        const child: unknown[] = [];
        current.push(child);
        current = child;
      }
      return root;
    };

    const assertionError = assertThrows(
      () => assertObjectMatch({ value: createNestedArray() }, { value: createNestedArray() }),
      Error,
    );
    assertStringIncludes(assertionError.message, "Expected");
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

  it("rejects path separators in temporary path affixes consistently", async () => {
    await assertRejects(() => makeTempFile({ prefix: "nested/" }), TypeError);
    await assertRejects(
      () => makeTempDirWithOptions({ prefix: "nested\\" }),
      TypeError,
    );
  });

  it("keeps empty-prefix temporary directories inside an explicit base directory", async () => {
    await withTempDir(async (baseDir) => {
      const childDir = await makeTempDirWithOptions({ dir: baseDir, prefix: "" });
      try {
        assertEquals(dirname(childDir), baseDir);
      } finally {
        await remove(childDir, { recursive: true });
      }
    });
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

  it("Node temp helpers do not rely on Math.random or overwrite existing paths", async () => {
    if (isDeno) return;

    const originalRandom = Math.random;
    const paths = new Set<string>();
    Math.random = () => 0.25;
    try {
      const firstFile = await makeTempFile({ prefix: "vf-collision-", suffix: ".txt" });
      paths.add(firstFile);
      await writeTextFile(firstFile, "original");
      const secondFile = await makeTempFile({ prefix: "vf-collision-", suffix: ".txt" });
      paths.add(secondFile);
      assertNotEquals(secondFile, firstFile);
      assertEquals(await readTextFile(firstFile), "original");

      const firstDir = await makeTempDirWithOptions({ prefix: "vf-collision-" });
      paths.add(firstDir);
      const secondDir = await makeTempDirWithOptions({ prefix: "vf-collision-" });
      paths.add(secondDir);
      assertNotEquals(secondDir, firstDir);
    } finally {
      Math.random = originalRandom;
      await Promise.all(
        [...paths].map((path) => remove(path, { recursive: true }).catch(() => undefined)),
      );
    }
  });

  it("withTempFile removes its file after success", async () => {
    let capturedPath = "";
    await withTempFile(async (tempFile) => {
      capturedPath = tempFile;
      await writeTextFile(tempFile, "value");
    });
    await assertRejects(() => stat(capturedPath));
  });

  it("withEnv restores earlier changes when applying a later variable fails", async () => {
    const key = "VF_TEST_WITH_ENV_TRANSACTION";
    const original = getEnv(key);

    await assertRejects(
      () => withEnv({ [key]: "changed", "": "invalid" }, async () => undefined),
      TypeError,
    );
    assertEquals(getEnv(key), original);
  });

  it("withEnv isolates overlapping scopes", async () => {
    const key = "VF_TEST_WITH_ENV_CONCURRENCY";
    let firstStarted: (() => void) | undefined;
    let secondStarted: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => firstStarted = resolve);
    const secondReady = new Promise<void>((resolve) => secondStarted = resolve);
    const secondRelease = new Promise<void>((resolve) => releaseSecond = resolve);

    const first = withEnv({ [key]: "first" }, async () => {
      firstStarted?.();
      await secondReady;
      return getEnv(key);
    });
    await firstReady;
    const second = withEnv({ [key]: "second" }, async () => {
      secondStarted?.();
      await secondRelease;
      return getEnv(key);
    });

    const firstValue = await first;
    releaseSecond?.();
    const secondValue = await second;
    assertEquals(firstValue, "first");
    assertEquals(secondValue, "second");
  });

  it("withEnv restores variables after a synchronous callback", async () => {
    const key = "VF_TEST_WITH_ENV_SYNC";
    const original = getEnv(key);
    const value = await withEnv({ [key]: "scoped" }, () => {
      assertEquals(getEnv(key), "scoped");
      return 42;
    });
    assertEquals(value, 42);

    if (original === undefined) deleteEnv(key);
    else setEnv(key, original);
    assertEquals(getEnv(key), original);
  });

  it("withEnv preserves valid environment keys that overlap object prototypes", async () => {
    const key = "__proto__";
    await withEnv({ [key]: "scoped" }, () => {
      assertEquals(process.env[key], "scoped");
      assertEquals(Object.keys(process.env).includes(key), true);
    });
  });

  it("withEnv does not invoke accessor-backed overrides", async () => {
    let getterCalls = 0;
    const vars = Object.create(null) as Record<string, string>;
    Object.defineProperty(vars, "VF_TEST_WITH_ENV_ACCESSOR", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unexpected";
      },
    });

    await assertRejects(
      () => withEnv(vars, () => undefined),
      TypeError,
      "data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("waitFor checks zero-timeout conditions once", async () => {
    let attempts = 0;
    await assertRejects(() =>
      waitFor(
        () => {
          attempts++;
          return false;
        },
        { timeout: 0, interval: 1 },
      )
    );
    assertEquals(attempts, 1);

    await waitFor(() => true, { timeout: 0 });
  });

  it("waitFor does not overshoot its timeout by a long polling interval", async () => {
    await withEnv({ VF_TEST_TIME_SCALE: "1" }, async () => {
      const startedAt = performance.now();
      await assertRejects(() => waitFor(() => false, { timeout: 20, interval: 1_000 }));
      const elapsed = performance.now() - startedAt;
      assert(elapsed < 500, `Expected waitFor to stop near its timeout, took ${elapsed}ms`);
    });
  });

  it("waitFor bounds a condition promise that never settles", async () => {
    const wait = waitFor(
      () => new Promise<boolean>(() => undefined),
      { timeout: 20, interval: 1 },
    ).then(
      () => "resolved",
      () => "timed-out",
    );
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<string>((resolve) => {
      guardTimer = setTimeout(() => resolve("hung"), 200);
    });
    try {
      assertEquals(await Promise.race([wait, guard]), "timed-out");
    } finally {
      if (guardTimer !== undefined) clearTimeout(guardTimer);
    }
  });

  it("waitFor stops promptly when its signal is aborted", async () => {
    const controller = new AbortController();
    const wait = waitFor(
      () => new Promise<boolean>(() => undefined),
      { timeout: 5_000, interval: 1, signal: controller.signal },
    );
    controller.abort(new Error("stop waiting"));
    await assertRejects(() => wait, Error, "stop waiting");
  });

  it("waitFor keeps oversized timeout diagnostics inside the typed error contract", async () => {
    const error = await assertRejects(
      () =>
        waitFor(() => false, {
          timeout: 0,
          message: `condition not ready\u202e${"x".repeat(20_000)}`,
        }),
      VeryfrontError,
    );

    assertEquals(error.slug, "timeout-error");
    assert(error.detail !== undefined);
    assert(error.detail.length <= 16_384);
    assertEquals(error.detail.includes("\u202e"), false);
  });
});
