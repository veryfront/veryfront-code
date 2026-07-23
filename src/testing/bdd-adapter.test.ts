import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import {
  resolveBunTestAdapter,
  resolveDefaultTestTimeout,
  wrapTestFunctionWithTimeout,
} from "./bdd-adapter.ts";

function createAdapter() {
  const noop = () => undefined;
  return {
    describe: noop,
    it: noop,
    beforeEach: noop,
    afterEach: noop,
    beforeAll: noop,
    afterAll: noop,
  };
}

describe("testing/Bun BDD adapter", () => {
  it("accepts named and default export shapes", () => {
    const named = createAdapter();
    const defaultExport = createAdapter();

    assertStrictEquals(resolveBunTestAdapter(named), named);
    assertStrictEquals(resolveBunTestAdapter({ default: defaultExport }), defaultExport);
  });

  it("rejects incomplete adapter modules", () => {
    assertEquals(resolveBunTestAdapter({ describe() {} }), undefined);
    assertEquals(resolveBunTestAdapter(undefined), undefined);
  });

  it("enforces finite positive portable timeouts", async () => {
    assertThrows(() => wrapTestFunctionWithTimeout(() => undefined, 0), RangeError);
    assertThrows(
      () => wrapTestFunctionWithTimeout(() => undefined, Number.POSITIVE_INFINITY),
      RangeError,
    );

    const timed = wrapTestFunctionWithTimeout(
      () => new Promise<void>(() => undefined),
      5,
    );
    await assertRejects(() => timed(), Error, "timed out after 5ms");

    let called = false;
    const completed = wrapTestFunctionWithTimeout(async () => {
      await Promise.resolve();
      called = true;
    }, 100);
    await completed();
    assertEquals(called, true);
  });

  it("rejects invalid Bun environment timeout values", () => {
    assertEquals(resolveDefaultTestTimeout(undefined, 30_000), 30_000);
    assertEquals(resolveDefaultTestTimeout("250", 30_000), 250);
    assertEquals(resolveDefaultTestTimeout("1.5", 30_000), 30_000);
    assertEquals(resolveDefaultTestTimeout("2147483648", 30_000), 30_000);
    assertEquals(resolveDefaultTestTimeout("Infinity", 30_000), 30_000);
    assertEquals(resolveDefaultTestTimeout("0", 30_000), 30_000);
  });
});
