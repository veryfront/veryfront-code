import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSleepTool, DEFAULT_SLEEP_TOOL_MAX_SECONDS, sleepTool } from "./sleep.ts";

describe("tool/sleep", () => {
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
