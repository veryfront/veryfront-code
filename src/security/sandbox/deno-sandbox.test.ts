import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { VeryfrontError } from "#veryfront/errors";
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
});

// SEC-008: Node.js Workers do not support permission isolation. The opt-in
// decision helper must be strict — only the literal "1" enables unsafe mode.
// Unit-testing the pure helper means coverage works under any runtime.
// The end-to-end guard case (runInWorker actually refusing on Node.js with the
// env var absent) needs host env mutation, so it lives in
// tests/integration/security/sandbox-runtime-guard.test.ts.
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
// The end-to-end guard case lives in
// tests/integration/security/sandbox-runtime-guard.test.ts (host env mutation).
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

  it("denies filesystem and network access inside the worker", async () => {
    // `permissions: "none"` is the whole isolation guarantee on the only
    // runtime this sandbox claims to be safe on. Match the permission family
    // rather than one exact wording so the case survives runtime upgrades.
    const fsError = await assertRejects(
      () => runInWorker<string>("return Deno.readTextFile('/etc/hosts');"),
      VeryfrontError,
      undefined,
      "a worker denied every permission must not read the host filesystem",
    ) as VeryfrontError;
    assert(
      /NotCapable|PermissionDenied|read access/i.test(fsError.message),
      "worker filesystem read must be denied by permissions: none",
    );
    assertEquals(
      fsError.message.includes("localhost"),
      false,
      "no /etc/hosts content may reach the host",
    );

    const netError = await assertRejects(
      () => runInWorker("return fetch('http://127.0.0.1:1/').then((r) => r.status);"),
      VeryfrontError,
      undefined,
      "a worker denied every permission must not open outbound sockets",
    ) as VeryfrontError;
    assert(
      /NotCapable|PermissionDenied|net access/i.test(netError.message),
      "worker network access must be denied by permissions: none",
    );
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
