import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { runInWorker } from "./deno-sandbox.ts";

const testSuite = isDeno ? describe : describe.skip;

testSuite("deno-sandbox", () => {
  it("runInWorker executes code and returns result", async () => {
    const result = await runInWorker<number>("return 21 * 2;");
    assertEquals(result, 42);
  });

  it("runInWorker handles errors", async () => {
    let threw = false;
    try {
      await runInWorker("throw new Error('boom')");
    } catch (e) {
      threw = String((e as Error)?.message || e).includes("boom");
    }
    assertEquals(threw, true);
  });

  it("runInWorker enforces timeout", async () => {
    let timedOut = false;
    try {
      await runInWorker("return new Promise((r) => setTimeout(() => r(1), 50));", {
        timeoutMs: 10,
      });
    } catch (e) {
      timedOut = String((e as Error)?.message || e).includes("timeout");
    }
    assertEquals(timedOut, true);
  });
});
