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
    const testSleepTool = createSleepTool({
      wait: (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    const result = await testSleepTool.execute({ seconds: 5 });

    assertEquals(waits, [5000]);
    assertEquals(result, {
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

  it("rejects invalid creation options", () => {
    for (const maxSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => createSleepTool({ maxSeconds, wait: () => undefined }),
        Error,
        "maxSeconds must be a positive safe integer",
      );
    }
    assertThrows(
      () => createSleepTool({ wait: null as never }),
      Error,
      "wait must be a function",
    );
  });

  it("forwards the execution abort signal to custom wait implementations", async () => {
    let receivedSignal: AbortSignal | undefined;
    const testSleepTool = createSleepTool({
      wait: (_milliseconds, signal) => {
        receivedSignal = signal;
      },
    });
    const controller = new AbortController();

    await testSleepTool.execute({ seconds: 1 }, { abortSignal: controller.signal });

    assertEquals(receivedSignal, controller.signal);
  });

  it("rejects immediately when the execution was already cancelled", async () => {
    const testSleepTool = createSleepTool({ maxSeconds: 1 });
    const controller = new AbortController();
    controller.abort(new Error("sleep cancelled"));

    await assertRejects(
      () => testSleepTool.execute({ seconds: 1 }, { abortSignal: controller.signal }),
      Error,
      "sleep cancelled",
    );
  });

  it("completes the built-in timer wait", async () => {
    const testSleepTool = createSleepTool({ maxSeconds: 1 });

    assertEquals(await testSleepTool.execute({ seconds: 1 }), {
      sleptFor: 1,
      message: "Waited for 1 second",
    });
  });

  it("clears and rejects the built-in timer when cancellation arrives", async () => {
    const testSleepTool = createSleepTool({ maxSeconds: 1 });
    const controller = new AbortController();
    const cancellation = setTimeout(
      () => controller.abort(new Error("sleep cancelled while waiting")),
      10,
    );

    try {
      await assertRejects(
        () => testSleepTool.execute({ seconds: 1 }, { abortSignal: controller.signal }),
        Error,
        "sleep cancelled while waiting",
      );
    } finally {
      clearTimeout(cancellation);
    }
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
    await assertRejects(
      () => sleepTool.execute({ seconds: 1.5 }),
      Error,
      'Tool "sleep" input validation failed',
    );
  });

  it("keeps lazy tool reads, writes, and descriptors on the same object", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(sleepTool, "id");
    if (!originalDescriptor) throw new Error("sleep tool id descriptor is missing");

    let observedId: string | undefined;
    let observedDescriptor: PropertyDescriptor | undefined;
    try {
      sleepTool.id = "renamed-sleep";
      observedId = sleepTool.id;
      observedDescriptor = Object.getOwnPropertyDescriptor(sleepTool, "id");
    } finally {
      Object.defineProperty(sleepTool, "id", originalDescriptor);
    }

    assertEquals(observedId, "renamed-sleep");
    assertEquals(observedDescriptor?.value, "renamed-sleep");
    assertEquals(sleepTool.id, "sleep");
  });

  it("preserves receiver semantics for objects inheriting from the lazy tool", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(sleepTool, "id");
    if (!originalDescriptor) throw new Error("sleep tool id descriptor is missing");
    const child = Object.create(sleepTool) as { id: string };

    try {
      child.id = "child-sleep";
      assertEquals(Object.hasOwn(child, "id"), true);
      assertEquals(child.id, "child-sleep");
      assertEquals(sleepTool.id, "sleep");
    } finally {
      Object.defineProperty(sleepTool, "id", originalDescriptor);
    }
  });
});
