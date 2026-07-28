import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, runCommand, setEnv } from "../process.ts";

describe("runCommand", () => {
  it("runs shell command strings through the native shell", async () => {
    const result = await runCommand("echo shell-works && echo shell-stderr >&2", {
      shell: true,
      capture: true,
    });

    assertEquals(result.success, true);
    assertEquals(result.stdout, "shell-works\n");
    assertEquals(result.stderr, "shell-stderr\n");
  });

  it("preserves shell command arguments with spaces and metacharacters", async () => {
    const result = await runCommand("deno", {
      shell: true,
      capture: true,
      args: [
        "eval",
        "console.log(JSON.stringify(Deno.args))",
        "value with spaces",
        "literal ; & | $ * chars",
      ],
    });

    assertEquals(result.success, true);
    assertEquals(
      result.stdout?.trim(),
      JSON.stringify(["value with spaces", "literal ; & | $ * chars"]),
    );
  });

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
});
