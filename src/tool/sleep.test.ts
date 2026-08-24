import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createSleepTool, DEFAULT_SLEEP_TOOL_MAX_SECONDS, sleepTool } from "./sleep.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

describe("tool/sleep", () => {
  afterEach(() => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

  it("requires the schema validator extension before creation", () => {
    reset();

    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);
    assertThrows(
      () => createSleepTool({ wait: () => undefined }),
      Error,
      "SchemaValidator",
    );
  });

  it("waits for the requested number of seconds and returns a concise result", async () => {
    const waits: number[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalWaitCalled: (() => void) | undefined;
    const waitCalled = new Promise<void>((resolve) => {
      signalWaitCalled = resolve;
    });
    const testSleepTool = createSleepTool({
      wait: (milliseconds) => {
        waits.push(milliseconds);
        signalWaitCalled?.();
        return gate;
      },
    });

    let settled = false;
    const pending = testSleepTool.execute({ seconds: 5 }).then((value) => {
      settled = true;
      return value;
    });

    await waitCalled;
    assertEquals(waits, [5000]);
    // Drain the microtask queue: execute must still be suspended on wait.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    assertEquals(settled, false, "execute must not resolve before wait settles");

    release?.();

    assertEquals(await pending, {
      sleptFor: 5,
      message: "Waited for 5 seconds",
    });
  });

  it("uses singular second copy for one second", async () => {
    const testSleepTool = createSleepTool({ wait: () => undefined });

    assertEquals(await testSleepTool.execute({ seconds: 1 }), {
      sleptFor: 1,
      message: "Waited for 1 second",
    });
  });

  it("supports custom maximum seconds", async () => {
    const testSleepTool = createSleepTool({ maxSeconds: 10, wait: () => undefined });

    assertEquals(testSleepTool.inputSchema.safeParse({ seconds: 10 }).success, true);
    assertEquals(testSleepTool.inputSchema.safeParse({ seconds: 11 }).success, false);
  });

  it("rejects invalid timer configuration before schema construction", () => {
    for (const maxSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484]) {
      assertThrows(
        () => createSleepTool({ maxSeconds, wait: () => undefined }),
        RangeError,
        "maxSeconds",
      );
    }

    assertThrows(
      () =>
        createSleepTool({
          wait: "not-a-function" as unknown as () => void,
        }),
      TypeError,
      "wait",
    );
  });

  it("rejects values outside the configured public schema bounds", async () => {
    await assertRejects(
      () => sleepTool.execute({ seconds: 0 }),
      Error,
      'Tool "sleep" input validation failed',
    );
    await assertRejects(
      () => sleepTool.execute({ seconds: DEFAULT_SLEEP_TOOL_MAX_SECONDS + 1 }),
      Error,
      'Tool "sleep" input validation failed',
    );
  });
});
