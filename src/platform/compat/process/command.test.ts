import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, execPath, getEnv, getRuntimeVersion, runCommand, setEnv } from "../process.ts";

function evalArgs(source: string): string[] {
  return getRuntimeVersion().startsWith("Node.js") ? ["--eval", source] : ["eval", source];
}

function capturedStderr(stderr: string | undefined, diagnostic: string): string {
  if (!stderr || stderr === diagnostic) return "";
  const diagnosticStart = stderr.lastIndexOf(`\n${diagnostic}`);
  return diagnosticStart < 0 ? stderr : stderr.slice(0, diagnosticStart);
}

describe("runCommand", () => {
  it("does not spawn a command when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop before spawn"));

    const result = await runCommand("__veryfront_must_not_spawn__", {
      capture: true,
      signal: controller.signal,
    });

    assertEquals(result.success, false);
    assertEquals(result.code, 130);
    assertEquals(result.stderr, "Command aborted");
  });

  it("terminates a running command when its signal aborts", async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(new Error("stop running command")), 25);
    const startedAt = Date.now();

    try {
      const result = await runCommand(execPath(), {
        args: evalArgs("setInterval(() => {}, 1_000);"),
        capture: true,
        signal: controller.signal,
        timeoutMs: 2_000,
      });

      assertEquals(result.success, false);
      assertEquals(result.code, 130);
      assertEquals(result.stderr, "Command aborted");
      assertEquals(Date.now() - startedAt < 1_000, true);
    } finally {
      clearTimeout(abortTimer);
    }
  });

  it("force kills an aborted command that ignores graceful termination", async () => {
    const controller = new AbortController();
    const ignoreTermination = getRuntimeVersion().startsWith("Node.js")
      ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);"
      : "Deno.addSignalListener('SIGTERM', () => {}); await new Promise(() => {});";
    const abortTimer = setTimeout(() => controller.abort(), 50);
    const startedAt = Date.now();

    try {
      const result = await runCommand(execPath(), {
        args: evalArgs(ignoreTermination),
        capture: true,
        signal: controller.signal,
        timeoutMs: 3_000,
      });

      assertEquals(result.success, false);
      assertEquals(result.code, 130);
      assertEquals(result.stderr, "Command aborted");
      assertEquals(Date.now() - startedAt < 1_000, true);
    } finally {
      clearTimeout(abortTimer);
    }
  });

  it("removes its abort listener after a command settles", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const addEventListener = signal.addEventListener.bind(signal);
    const removeEventListener = signal.removeEventListener.bind(signal);
    let added = 0;
    let removed = 0;

    Object.defineProperties(signal, {
      addEventListener: {
        configurable: true,
        value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
          added += 1;
          return addEventListener(...args);
        },
      },
      removeEventListener: {
        configurable: true,
        value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
          removed += 1;
          return removeEventListener(...args);
        },
      },
    });

    const result = await runCommand(execPath(), {
      args: evalArgs("console.log('done');"),
      capture: true,
      signal,
      timeoutMs: 2_000,
    });

    assertEquals(result.success, true);
    assertEquals(added, 1);
    assertEquals(removed, 1);
  });

  it("terminates commands whose captured output exceeds the configured byte limit", async () => {
    const diagnostic = "Command captured output exceeded 64 bytes";
    const result = await runCommand(execPath(), {
      args: evalArgs(
        "console.log('o'.repeat(40)); console.error('e'.repeat(40));",
      ),
      capture: true,
      maxOutputBytes: 64,
      timeoutMs: 5_000,
    });

    assertEquals(result.success, false);
    assertEquals(result.code, 125);
    assertEquals(result.outputLimitExceeded, true);
    const capturedBytes = new TextEncoder().encode(result.stdout ?? "").byteLength +
      new TextEncoder().encode(capturedStderr(result.stderr, diagnostic)).byteLength;
    assertEquals(capturedBytes, 64);
    assertEquals(result.stderr?.includes(diagnostic), true);
  });

  it("allows combined captured output exactly at the configured byte limit", async () => {
    const result = await runCommand(execPath(), {
      args: evalArgs(
        "console.log('o'.repeat(31)); console.error('e'.repeat(31));",
      ),
      capture: true,
      maxOutputBytes: 64,
      timeoutMs: 5_000,
    });

    assertEquals(result.success, true);
    assertEquals(result.code, 0);
    assertEquals(result.outputLimitExceeded, undefined);
    const capturedBytes = new TextEncoder().encode(result.stdout ?? "").byteLength +
      new TextEncoder().encode(result.stderr ?? "").byteLength;
    assertEquals(capturedBytes, 64);
  });

  it("rejects invalid captured output limits before spawning a command", async () => {
    await assertRejects(
      () => runCommand(execPath(), { capture: true, maxOutputBytes: -1 }),
      RangeError,
      "maxOutputBytes",
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
