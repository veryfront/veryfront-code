import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import {
  collectSandboxExecResult,
  isSandboxOutputLimitError,
  normalizeSandboxExecRequest,
  normalizeSandboxFiles,
} from "./request-payload.ts";
import type { ExecStreamEvent } from "./types.ts";

async function* events(values: ExecStreamEvent[]): AsyncGenerator<ExecStreamEvent> {
  yield* values;
}

Deno.test("normalizeSandboxExecRequest snapshots supported data and keeps client limits local", () => {
  const normalized = normalizeSandboxExecRequest("echo ok", {
    cwd: "/workspace",
    timeout_seconds: 30,
    env: { CI: "true" },
    maxOutputBytes: 1024,
  }, "project-1");

  assertEquals(normalized, {
    payload: {
      command: "echo ok",
      cwd: "/workspace",
      timeout_seconds: 30,
      env: { CI: "true" },
      projectReference: "project-1",
    },
    maxOutputBytes: 1024,
  });
  assertEquals(
    normalizeSandboxExecRequest("echo ok", { projectReference: " project-2 " }).payload,
    { command: "echo ok", projectReference: "project-2" },
  );
});

Deno.test("sandbox request normalization rejects accessors without invoking them", () => {
  let execAccessorCalled = false;
  const options = {};
  Object.defineProperty(options, "cwd", {
    enumerable: true,
    get() {
      execAccessorCalled = true;
      return "/workspace";
    },
  });
  assertThrows(
    () => normalizeSandboxExecRequest("pwd", options),
    VeryfrontError,
    "must be a data property",
  );
  assertEquals(execAccessorCalled, false);

  let fileAccessorCalled = false;
  const file = { content: "safe" };
  Object.defineProperty(file, "path", {
    enumerable: true,
    get() {
      fileAccessorCalled = true;
      return "file.txt";
    },
  });
  assertThrows(
    () => normalizeSandboxFiles([file as { path: string; content: string }]),
    VeryfrontError,
    "must be a data property",
  );
  assertEquals(fileAccessorCalled, false);

  let arrayAccessorCalled = false;
  const files: Array<{ path: string; content: string }> = [];
  Object.defineProperty(files, "0", {
    enumerable: true,
    get() {
      arrayAccessorCalled = true;
      return { path: "file.txt", content: "safe" };
    },
  });
  assertThrows(
    () => normalizeSandboxFiles(files),
    VeryfrontError,
    "must be a data property",
  );
  assertEquals(arrayAccessorCalled, false);
});

Deno.test("collectSandboxExecResult requires a terminal exit and enforces its byte budget", async () => {
  assertEquals(
    await collectSandboxExecResult(
      events([
        { type: "stdout", data: "ok\n" },
        { type: "exit", exitCode: 0 },
      ]),
      16,
    ),
    { stdout: "ok\n", stderr: "", exitCode: 0 },
  );

  await assertRejects(
    () => collectSandboxExecResult(events([{ type: "stdout", data: "partial" }]), 16),
    VeryfrontError,
    "ended without an exit event",
  );
  await assertRejects(
    () =>
      collectSandboxExecResult(
        events([
          { type: "stdout", data: "too large" },
          { type: "exit", exitCode: 0 },
        ]),
        4,
      ),
    VeryfrontError,
    "output exceeded 4 bytes",
  );
  await assertRejects(
    () =>
      collectSandboxExecResult(
        events([{ type: "error", data: "runtime unavailable" }]),
        1024,
      ),
    VeryfrontError,
    "runtime unavailable",
  );
});

Deno.test("isSandboxOutputLimitError recognizes only the typed output-limit cause", async () => {
  let outputLimitError: unknown;
  try {
    await collectSandboxExecResult(
      events([
        { type: "stdout", data: "too large" },
        { type: "exit", exitCode: 0 },
      ]),
      4,
    );
  } catch (error) {
    outputLimitError = error;
  }

  assertEquals(isSandboxOutputLimitError(outputLimitError), true);
  assertEquals(
    isSandboxOutputLimitError(
      new Error("Sandbox command output exceeded 4 bytes; use executeStream()"),
    ),
    false,
  );
  assertEquals(
    isSandboxOutputLimitError(
      new Error("Sandbox command output exceeded 4 bytes", {
        cause: Object.assign(
          new Error("Sandbox command output exceeded 4 bytes"),
          { name: "SandboxOutputLimitCause" },
        ),
      }),
    ),
    false,
  );
  assertEquals(isSandboxOutputLimitError(new Error("other sandbox failure")), false);
  assertEquals(isSandboxOutputLimitError(null), false);
});
