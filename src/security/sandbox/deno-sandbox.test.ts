import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { runInWorker } from "./deno-sandbox.ts";
import { MAX_SANDBOX_CODE_SIZE } from "./constants.ts";

// Input validation tests work in all runtimes (no Worker needed)
describe("deno-sandbox input validation", () => {
  it("rejects empty code", async () => {
    await assertRejects(
      () => runInWorker(""),
      Error,
      "empty",
    );
  });

  it("rejects non-string code", async () => {
    await assertRejects(
      () => runInWorker(123 as unknown as string),
      Error,
      "string",
    );
  });

  it("rejects oversized code", async () => {
    await assertRejects(
      () => runInWorker("x".repeat(MAX_SANDBOX_CODE_SIZE + 1)),
      Error,
      "maximum size",
    );
  });

  it("enforces byte length not character count", async () => {
    // 4-byte emoji repeated to exceed limit by byte count but not char count
    const fourByteChar = "\u{1F600}"; // 😀 = 4 bytes in UTF-8
    const count = Math.floor(MAX_SANDBOX_CODE_SIZE / 4) + 1;
    const code = fourByteChar.repeat(count);
    // code.length (UTF-16 units) = count * 2, but byte length > MAX_SANDBOX_CODE_SIZE
    await assertRejects(
      () => runInWorker(code),
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
