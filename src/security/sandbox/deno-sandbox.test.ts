import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import {
  BUN_SANDBOX_ALLOW_UNSAFE_ENV,
  isBunSandboxAllowedUnsafe,
  isNodeSandboxAllowedUnsafe,
  NODE_SANDBOX_ALLOW_UNSAFE_ENV,
  runInWorker,
} from "./deno-sandbox.ts";
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

  it("rejects invalid timeout values before creating a worker", async () => {
    for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assertRejects(
        () => runInWorker("return 1;", { timeoutMs }),
        Error,
        "positive safe integer",
      );
    }
  });

  it("rejects invalid memory limits before creating a worker", async () => {
    for (const memoryLimitMb of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assertRejects(
        () => runInWorker("return 1;", { memoryLimitMb }),
        Error,
        "positive safe integer",
      );
    }
  });
});

// SEC-008: Node.js Workers do not support permission isolation. The opt-in
// decision helper must be strict — only the literal "1" enables unsafe mode.
// Unit-testing the pure helper means coverage works under any runtime.
describe("deno-sandbox Node opt-in guard (SEC-008)", () => {
  it("exposes the documented env var name", () => {
    assertEquals(NODE_SANDBOX_ALLOW_UNSAFE_ENV, "VERYFRONT_NODE_SANDBOX_ALLOW_UNSAFE");
  });

  it("blocks when env var is undefined", () => {
    assertEquals(isNodeSandboxAllowedUnsafe(undefined), false);
  });

  it("blocks when env var is empty", () => {
    assertEquals(isNodeSandboxAllowedUnsafe(""), false);
  });

  it("blocks when env var is '0'", () => {
    assertEquals(isNodeSandboxAllowedUnsafe("0"), false);
  });

  it("blocks when env var is loose truthy (rejects 'true', 'yes', etc.)", () => {
    assertEquals(isNodeSandboxAllowedUnsafe("true"), false);
    assertEquals(isNodeSandboxAllowedUnsafe("TRUE"), false);
    assertEquals(isNodeSandboxAllowedUnsafe("yes"), false);
    assertEquals(isNodeSandboxAllowedUnsafe("on"), false);
    assertEquals(isNodeSandboxAllowedUnsafe("1 "), false);
    assertEquals(isNodeSandboxAllowedUnsafe(" 1"), false);
  });

  it("allows execution only on the literal string '1'", () => {
    assertEquals(isNodeSandboxAllowedUnsafe("1"), true);
  });
});

// SEC-008: Bun Workers have no permission isolation. The opt-in decision helper
// must be strict — only the literal "1" enables unsafe mode. Unit-testing the
// pure helper means coverage works under any runtime.
describe("deno-sandbox Bun opt-in guard (SEC-008)", () => {
  it("exposes the documented env var name", () => {
    assertEquals(BUN_SANDBOX_ALLOW_UNSAFE_ENV, "VERYFRONT_BUN_SANDBOX_ALLOW_UNSAFE");
  });

  it("blocks when env var is undefined", () => {
    assertEquals(isBunSandboxAllowedUnsafe(undefined), false);
  });

  it("blocks when env var is empty", () => {
    assertEquals(isBunSandboxAllowedUnsafe(""), false);
  });

  it("blocks when env var is '0'", () => {
    assertEquals(isBunSandboxAllowedUnsafe("0"), false);
  });

  it("blocks when env var is loose truthy (rejects 'true', 'yes', etc.)", () => {
    assertEquals(isBunSandboxAllowedUnsafe("true"), false);
    assertEquals(isBunSandboxAllowedUnsafe("TRUE"), false);
    assertEquals(isBunSandboxAllowedUnsafe("yes"), false);
    assertEquals(isBunSandboxAllowedUnsafe("on"), false);
    assertEquals(isBunSandboxAllowedUnsafe("1 "), false);
    assertEquals(isBunSandboxAllowedUnsafe(" 1"), false);
  });

  it("allows execution only on the literal string '1'", () => {
    assertEquals(isBunSandboxAllowedUnsafe("1"), true);
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
