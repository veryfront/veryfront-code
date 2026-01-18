import { assertEquals } from "@std/assert";
import { runInWorker } from "./deno-sandbox.ts";

Deno.test("runInWorker executes code and returns result", async () => {
  const result = await runInWorker<number>("return 21 * 2;");
  assertEquals(result, 42);
});

Deno.test("runInWorker handles errors", async () => {
  let threw = false;
  try {
    await runInWorker("throw new Error('boom')");
  } catch (e) {
    threw = String((e as any)?.message || e).includes("boom");
  }
  assertEquals(threw, true);
});

Deno.test("runInWorker enforces timeout", async () => {
  let timedOut = false;
  try {
    await runInWorker("return new Promise((r) => setTimeout(() => r(1), 50));", {
      timeoutMs: 10,
    });
  } catch (e) {
    timedOut = String((e as any)?.message || e).includes("timeout");
  }
  assertEquals(timedOut, true);
});
