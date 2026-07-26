import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRetryableModuleLoader, createSerialAsyncExecutor } from "./code-block-runtime.ts";

describe("createRetryableModuleLoader", () => {
  it("coalesces concurrent imports and caches the fulfilled module", async () => {
    let importCalls = 0;
    let resolveImport!: (value: { value: number }) => void;
    const loader = createRetryableModuleLoader(() => {
      importCalls += 1;
      return new Promise<{ value: number }>((resolve) => {
        resolveImport = resolve;
      });
    });

    const first = loader.load();
    const second = loader.load();
    assertEquals(importCalls, 1);

    const expected = { value: 42 };
    resolveImport(expected);
    assertStrictEquals(await first, expected);
    assertStrictEquals(await second, expected);
    assertStrictEquals(await loader.load(), expected);
    assertEquals(importCalls, 1);
  });

  it("retries after a rejected import", async () => {
    let importCalls = 0;
    const expected = { value: 42 };
    const loader = createRetryableModuleLoader(async () => {
      importCalls += 1;
      if (importCalls === 1) throw new Error("transient");
      return expected;
    });

    await assertRejects(() => loader.load(), Error, "transient");
    assertStrictEquals(await loader.load(), expected);
    assertEquals(importCalls, 2);
  });

  it("caches a fulfilled undefined value without importing again", async () => {
    let importCalls = 0;
    const loader = createRetryableModuleLoader(async () => {
      importCalls += 1;
      return undefined;
    });

    assertEquals(await loader.load(), undefined);
    assertEquals(await loader.load(), undefined);
    assertEquals(importCalls, 1);
  });
});

describe("createSerialAsyncExecutor", () => {
  it("runs operations in FIFO order and continues after rejection", async () => {
    const execute = createSerialAsyncExecutor();
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = execute(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      throw new Error("expected");
    });
    const second = execute(async () => {
      events.push("second");
      return 42;
    });

    await Promise.resolve();
    assertEquals(events, ["first:start"]);
    releaseFirst();
    await assertRejects(() => first, Error, "expected");
    assertEquals(await second, 42);
    assertEquals(events, ["first:start", "first:end", "second"]);
  });
});
