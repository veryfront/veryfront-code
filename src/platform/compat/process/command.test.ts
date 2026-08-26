import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "../fs.ts";
import { deleteEnv, execPath, getEnv, getOsType, runCommand, setEnv } from "../process.ts";
import { isDeno } from "../runtime.ts";
import { buildWindowsTaskkillArgs, type CommandOptions } from "./command.ts";

function runtimeEvalArgs(source: string): string[] {
  return isDeno ? ["eval", source] : ["-e", source];
}

function detachedDescendantParentScript(): string {
  const descendantSource = isDeno
    ? 'setTimeout(() => console.log("escaped-descendant"), 800);'
    : 'setTimeout(() => process.stdout.write("escaped-descendant"), 800);';
  if (isDeno) {
    return `
      const deno = globalThis["Deno"];
      const child = new deno.Command(deno.execPath(), {
        args: ["eval", ${JSON.stringify(descendantSource)}],
        detached: true,
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      child.unref();
      setInterval(() => {}, 1_000);
    `;
  }
  return `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.unref();
    setInterval(() => {}, 1_000);
  `;
}

function normalizeNewlines(output: string | undefined): string | undefined {
  return output?.replaceAll("\r\n", "\n");
}

describe("runCommand", () => {
  it("runs shell command strings through the native shell", async () => {
    const result = await runCommand("echo shell-works && echo shell-stderr >&2", {
      shell: true,
      capture: true,
    });

    assertEquals(result.success, true);
    assertEquals(normalizeNewlines(result.stdout), "shell-works\n");
    assertEquals(normalizeNewlines(result.stderr), "shell-stderr\n");
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

  it("keeps inherited environment variables when adding an explicit value", async () => {
    const explicitKey = "VERYFRONT_RUN_COMMAND_EXPLICIT_MERGE";
    const inheritedPath = getEnv("PATH");
    assertEquals(typeof inheritedPath, "string");

    const result = await runCommand("env", {
      capture: true,
      env: { [explicitKey]: "available" },
    });

    assertEquals(result.success, true);
    assertEquals(result.stdout?.includes(`PATH=${inheritedPath}`), true);
    assertEquals(result.stdout?.includes(`${explicitKey}=available`), true);
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

  it("rejects invalid process-tree ownership flags before spawning", async () => {
    await assertRejects(
      () =>
        runCommand("veryfront-command-that-must-not-be-resolved", {
          terminateProcessTreeOnExit: "yes" as unknown as boolean,
        }),
      TypeError,
      "terminateProcessTreeOnExit",
    );
  });

  it("preserves legacy timeout defaulting and fractional normalization", async () => {
    for (const timeoutMs of [-1, 0, 0.5, Number.NaN]) {
      const result = await runCommand("echo", {
        args: ["no-timeout"],
        capture: true,
        timeoutMs,
      });
      assertEquals(result.success, true);
      assertEquals(result.stdout?.trim(), "no-timeout");
    }

    const longTimerScript = isDeno
      ? 'await new Promise((resolve) => setTimeout(resolve, 20)); console.log("clamped");'
      : 'setTimeout(() => process.stdout.write("clamped"), 20);';
    for (const timeoutMs of [2_147_483_648, Number.POSITIVE_INFINITY]) {
      const result = await runCommand(execPath(), {
        args: runtimeEvalArgs(longTimerScript),
        capture: true,
        timeoutMs,
      });
      assertEquals(result.success, true);
      assertEquals(result.stdout?.trim(), "clamped");
    }

    const timed = await runCommand("sh", {
      args: ["-c", "sleep 1"],
      capture: true,
      timeoutMs: 25.9,
    });
    assertEquals(timed.code, 124);
    assertEquals(timed.stderr?.includes("25ms"), true);
  });

  it("builds bounded Windows taskkill tree commands", () => {
    assertEquals(buildWindowsTaskkillArgs(42, false), ["/PID", "42", "/T"]);
    assertEquals(buildWindowsTaskkillArgs(42, true), ["/PID", "42", "/T", "/F"]);
    assertThrows(
      () => buildWindowsTaskkillArgs(0, true),
      RangeError,
      "positive safe integer",
    );
  });

  it("does not spawn work for an already-aborted command", async () => {
    const controller = new AbortController();
    controller.abort();
    const options: CommandOptions & { signal: AbortSignal } = {
      args: isDeno
        ? ["eval", "await new Promise((resolve) => setTimeout(resolve, 10_000));"]
        : ["-e", "setTimeout(() => {}, 10_000)"],
      capture: true,
      signal: controller.signal,
      timeoutMs: 100,
    };

    const result = await runCommand(execPath(), options);

    assertEquals(result.success, false);
    assertEquals(result.code, 130);
    assertEquals(result.stderr?.includes("aborted"), true);
  });

  it("rejects invalid abort signals before resolving the executable", async () => {
    await assertRejects(
      () =>
        runCommand("veryfront-command-that-must-not-be-resolved", {
          signal: { aborted: false } as AbortSignal,
        }),
      TypeError,
      "AbortSignal",
    );
  });

  it("terminates descendants when a command times out", async () => {
    if (getOsType() === "windows") return;

    const result = await runCommand("sh", {
      args: ["-c", "(trap '' TERM; sleep 1; printf descendant-survived) & wait"],
      capture: true,
      timeoutMs: 25,
    });

    assertEquals(result.code, 124);
    assertEquals(result.stdout?.includes("descendant-survived"), false);
  });

  it("retains force-kill escalation after the timed-out parent exits", async () => {
    if (getOsType() === "windows") return;

    const directory = await makeTempDir({ prefix: "veryfront-command-tree-" });
    const survivorMarker = `${directory}/descendant-survived`;
    try {
      const result = await runCommand("sh", {
        args: [
          "-c",
          [
            "(trap '' TERM; sleep 0.6; printf survived > \"$1\") >/dev/null 2>&1 &",
            "trap 'exit 0' TERM",
            "wait",
          ].join("\n"),
          "sh",
          survivorMarker,
        ],
        capture: true,
        timeoutMs: 25,
      });

      assertEquals(result.code, 124);
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      assertEquals(await exists(survivorMarker), false);
    } finally {
      await remove(directory, { recursive: true });
    }
  });

  it("optionally terminates background descendants after a successful parent exit", async () => {
    if (getOsType() === "windows") return;

    const directory = await makeTempDir({ prefix: "veryfront-command-owned-tree-" });
    const survivorMarker = `${directory}/descendant-survived`;
    try {
      const result = await runCommand("sh", {
        args: [
          "-c",
          '(sleep 0.4; printf survived > "$1") >/dev/null 2>&1 & exit 0',
          "sh",
          survivorMarker,
        ],
        capture: true,
        terminateProcessTreeOnExit: true,
      });

      assertEquals(result.code, 0);
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      assertEquals(await exists(survivorMarker), false);
    } finally {
      await remove(directory, { recursive: true });
    }
  });

  it("terminates descendants when an in-flight command is aborted", async () => {
    if (getOsType() === "windows") return;

    const controller = new AbortController();
    const pending = runCommand("sh", {
      args: ["-c", "(sleep 1; printf descendant-survived) & wait"],
      capture: true,
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    setTimeout(() => controller.abort(), 25);

    const result = await pending;

    assertEquals(result.code, 130);
    assertEquals(result.stdout?.includes("descendant-survived"), false);
  });

  it("reports truncated output when timeout wins the termination race", async () => {
    if (getOsType() === "windows") return;

    const payload = "x".repeat(1_024);
    const result = await runCommand("sh", {
      args: [
        "-c",
        `trap 'printf ${payload}; exit 0' TERM; while :; do :; done`,
      ],
      capture: true,
      maxOutputBytes: 128,
      timeoutMs: 25,
    });

    assertEquals(result.code, 124);
    assertEquals(result.stdout?.length, 128);
    assertEquals(result.outputTruncated, true);
  });

  it("bounds return latency when a detached POSIX descendant retains capture pipes", async () => {
    if (getOsType() === "windows") return;

    const startedAt = performance.now();
    const result = await runCommand(execPath(), {
      args: runtimeEvalArgs(detachedDescendantParentScript()),
      capture: true,
      timeoutMs: 25,
    });
    const elapsedMs = performance.now() - startedAt;

    assertEquals(result.code, 124);
    assertEquals(result.stdout?.includes("escaped-descendant"), false);
    assertEquals(elapsedMs < 600, true);
  });
});
