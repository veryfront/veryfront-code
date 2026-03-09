import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { runInWorker } from "./deno-sandbox.ts";
import { MAX_SANDBOX_CODE_SIZE } from "./constants.ts";

// Input validation tests work in all runtimes (no Worker needed)
describe("deno-sandbox input validation", () => {
  it("rejects empty code", () => {
    assertThrows(
      () => runInWorker(""),
      Error,
      "empty",
    );
  });

  it("rejects non-string code", () => {
    assertThrows(
      () => runInWorker(123 as unknown as string),
      Error,
      "string",
    );
  });

  it("rejects oversized code", () => {
    assertThrows(
      () => runInWorker("x".repeat(MAX_SANDBOX_CODE_SIZE + 1)),
      Error,
      "maximum size",
    );
  });
});

const testSuite = isDeno ? describe : describe.skip;

testSuite("deno-sandbox", () => {
  it("runInWorker executes code and returns result", async () => {
    const result = await runInWorker<number>("return 21 * 2;");
    assertEquals(result, 42);
  });

  it("runInWorker handles errors", async () => {
    try {
      await runInWorker("throw new Error('boom')");
      assertEquals(false, true);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      assertEquals(message.includes("boom"), true);
    }
  });

  it("runInWorker enforces timeout", async () => {
    try {
      await runInWorker("return new Promise((r) => setTimeout(() => r(1), 50));", {
        timeoutMs: 10,
      });
      assertEquals(false, true);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      assertEquals(message.includes("timeout"), true);
    }
  });
});
