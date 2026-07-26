import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, execPath, getEnv, runCommand, setEnv } from "../process.ts";
import { isDeno } from "../runtime.ts";

describe("runCommand", () => {
  it("clears inherited environment variables", async () => {
    const inheritedKey = "VERYFRONT_RUN_COMMAND_INHERITED";
    const explicitKey = "VERYFRONT_RUN_COMMAND_EXPLICIT";
    setEnv(inheritedKey, "must-not-leak");

    try {
      const path = getEnv("PATH");
      const result = await runCommand("env", {
        capture: true,
        clearEnv: true,
        env: {
          ...(path ? { PATH: path } : {}),
          [explicitKey]: "available",
        },
      });

      assertEquals(result.success, true);
      assertEquals(result.stdout?.includes(`${explicitKey}=available`), true);
      assertEquals(result.stdout?.includes(`${inheritedKey}=`), false);
    } finally {
      deleteEnv(inheritedKey);
    }
  });

  it("honors shell execution across runtimes", async () => {
    const result = await runCommand("echo shell-ok", {
      capture: true,
      shell: true,
    });

    assertEquals(result.success, true);
    assertEquals(result.stdout?.trim(), "shell-ok");
  });

  it("decodes captured UTF-8 after joining runtime output chunks", async () => {
    const script = isDeno
      ? "for (const byte of [0xe2, 0x82, 0xac]) await globalThis['Deno']['stdout'].write(Uint8Array.of(byte));"
      : "for (const byte of [0xe2, 0x82, 0xac]) process.stdout.write(Uint8Array.of(byte));";
    const result = await runCommand(execPath(), {
      args: isDeno ? ["eval", script] : ["-e", script],
      capture: true,
    });

    assertEquals(result.success, true);
    assertEquals(result.stdout, "€");
  });

  it("terminates capture when combined output exceeds its byte budget", async () => {
    const script = isDeno
      ? 'await globalThis["Deno"]["stdout"].write(new TextEncoder().encode("x".repeat(4096)));'
      : 'process.stdout.write("x".repeat(4096));';
    const result = await runCommand(execPath(), {
      args: isDeno ? ["eval", script] : ["-e", script],
      capture: true,
      maxOutputBytes: 128,
    });

    assertEquals(result.success, false);
    assertEquals(result.code, 125);
    assertEquals(result.outputTruncated, true);
    assertEquals(result.stdout?.length, 128);
    assertEquals(result.stderr?.includes("exceeded 128 bytes"), true);
  });

  it("rejects invalid capture budgets before spawning", async () => {
    await assertRejects(
      () => runCommand("echo", { maxOutputBytes: 0 }),
      RangeError,
      "positive safe integer",
    );
  });
});
