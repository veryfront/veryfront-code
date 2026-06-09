import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import {
  type HostedLifecycleAdapter,
  type HostedLifecycleTerminalState,
  runHostedLifecycle,
} from "./lifecycle.ts";

function createAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

function captureConsoleLog(): { getOutput: () => string; restore: () => void } {
  const originalLog = console.log;
  const originalDebug = console.debug;
  let capturedOutput = "";

  const capture = (msg: string) => {
    capturedOutput = msg;
  };

  console.log = capture;
  console.debug = capture;

  return {
    getOutput: () => capturedOutput,
    restore: () => {
      console.log = originalLog;
      console.debug = originalDebug;
    },
  };
}

async function withJsonDebugLogFormat<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();

  try {
    return await fn();
  } finally {
    Deno.env.delete("LOG_FORMAT");
    Deno.env.delete("LOG_LEVEL");
    __resetLoggerConfigForTests();
  }
}

describe("agent/hosted-lifecycle", () => {
  it("runs start, chunk append/transcript hooks, then terminal hooks on success", async () => {
    const calls: string[] = [];
    const adapter: HostedLifecycleAdapter<{ runId: string }, string> = {
      startRun: () => {
        calls.push("startRun");
        return { runId: "run-1" };
      },
      appendEvents: (_run, chunk) => {
        calls.push(`append:${chunk}`);
      },
      persistTranscriptChunk: (_run, chunk) => {
        calls.push(`persistChunk:${chunk}`);
      },
      persistTranscriptTerminalState: (_run, state) => {
        calls.push(`persistTerminal:${state.status}`);
      },
      onTerminalState: (_run, state) => {
        calls.push(`onTerminal:${state.status}`);
      },
      finalizeRun: (_run, state) => {
        calls.push(`finalize:${state.status}`);
      },
    };

    const result = await runHostedLifecycle({
      abortSignal: createAbortSignal(),
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield "a";
            yield "b";
          },
        },
        waitForFinish: async () => {
          calls.push("waitForFinish");
        },
      },
      adapter,
      resolveTerminalState: (): HostedLifecycleTerminalState => ({
        status: "completed",
        metadata: {
          modelId: "openai/gpt-5.4",
        },
      }),
    });

    assertEquals(result.run, { runId: "run-1" });
    assertEquals(result.terminalState.status, "completed");
    assertEquals(calls, [
      "startRun",
      "append:a",
      "persistChunk:a",
      "append:b",
      "persistChunk:b",
      "waitForFinish",
      "persistTerminal:completed",
      "onTerminal:completed",
      "finalize:completed",
    ]);
  });

  it("dispatches cancelRun for cancelled terminal states", async () => {
    const calls: string[] = [];

    await runHostedLifecycle({
      abortSignal: createAbortSignal(),
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield "chunk";
          },
        },
        waitForFinish: async () => {
          calls.push("waitForFinish");
        },
      },
      adapter: {
        startRun: () => ({ runId: "run-1" }),
        cancelRun: (_run, state) => {
          calls.push(`cancel:${state.status}`);
        },
        onTerminalState: (_run, state) => {
          calls.push(`terminal:${state.status}`);
        },
      },
      resolveTerminalState: () => ({ status: "cancelled", terminalErrorCode: "ABORTED" }),
    });

    assertEquals(calls, ["waitForFinish", "terminal:cancelled", "cancel:cancelled"]);
  });

  it("maps thrown execution errors through the default failed terminal state and rethrows", async () => {
    const calls: string[] = [];
    const error = new Error("stream exploded");

    await assertRejects(
      () =>
        runHostedLifecycle({
          abortSignal: createAbortSignal(),
          execution: {
            stream: {
              [Symbol.asyncIterator]() {
                return {
                  next: async () => {
                    throw error;
                  },
                };
              },
            },
            waitForFinish: async () => {},
          },
          adapter: {
            startRun: () => ({ runId: "run-1" }),
            onTerminalState: (_run, state) => {
              calls.push(
                `${state.status}:${state.terminalErrorCode}:${state.terminalErrorMessage}`,
              );
            },
            finalizeRun: (_run, state) => {
              calls.push(`finalize:${state.status}`);
            },
          },
          resolveTerminalState: () => ({ status: "completed" }),
        }),
      Error,
      "stream exploded",
    );

    assertEquals(calls, ["failed:STREAM_ERROR:stream exploded", "finalize:failed"]);
  });

  it("supports custom error terminal state mapping", async () => {
    const calls: string[] = [];

    await assertRejects(
      () =>
        runHostedLifecycle({
          abortSignal: createAbortSignal(),
          execution: {
            stream: {
              [Symbol.asyncIterator]() {
                return {
                  next: async () => {
                    throw new Error("cancelled by host");
                  },
                };
              },
            },
            waitForFinish: async () => {},
          },
          adapter: {
            startRun: () => ({ runId: "run-1" }),
            cancelRun: (_run, state) => {
              calls.push(`cancel:${state.terminalErrorCode}`);
            },
          },
          resolveTerminalState: () => ({ status: "completed" }),
          resolveErrorTerminalState: () => ({
            status: "cancelled",
            terminalErrorCode: "HOST_CANCELLED",
            terminalErrorMessage: "cancelled by host",
          }),
        }),
      Error,
      "cancelled by host",
    );

    assertEquals(calls, ["cancel:HOST_CANCELLED"]);
  });

  it("still finalizes when transcript hooks fail on success", async () => {
    const calls: string[] = [];

    await assertRejects(
      () =>
        runHostedLifecycle({
          abortSignal: createAbortSignal(),
          execution: {
            stream: {
              async *[Symbol.asyncIterator]() {
                yield "chunk";
              },
            },
            waitForFinish: async () => {
              calls.push("waitForFinish");
            },
          },
          adapter: {
            startRun: () => ({ runId: "run-1" }),
            persistTranscriptTerminalState: () => {
              calls.push("persistTerminal");
              throw new Error("persist failed");
            },
            onTerminalState: () => {
              calls.push("onTerminal");
            },
            finalizeRun: () => {
              calls.push("finalize");
            },
          },
          resolveTerminalState: () => ({ status: "completed" }),
        }),
      Error,
      "persist failed",
    );

    assertEquals(calls, ["waitForFinish", "persistTerminal", "onTerminal", "finalize"]);
  });

  it("rethrows the original execution error even when terminal hooks fail", async () => {
    const calls: string[] = [];
    const executionError = new Error("stream exploded");
    const { getOutput, restore } = captureConsoleLog();

    try {
      await withJsonDebugLogFormat(async () => {
        await assertRejects(
          () =>
            runHostedLifecycle({
              abortSignal: createAbortSignal(),
              execution: {
                stream: {
                  [Symbol.asyncIterator]() {
                    return {
                      next: async () => {
                        throw executionError;
                      },
                    };
                  },
                },
                waitForFinish: async () => {},
              },
              adapter: {
                startRun: () => ({ runId: "run-1" }),
                onTerminalState: () => {
                  calls.push("onTerminal");
                  throw new Error("observer failed");
                },
                finalizeRun: () => {
                  calls.push("finalize");
                },
              },
              resolveTerminalState: () => ({ status: "completed" }),
            }),
          Error,
          "stream exploded",
        );
      });
    } finally {
      restore();
    }

    assertEquals(calls, ["onTerminal", "finalize"]);
    const entry = JSON.parse(getOutput()) as LogEntry;
    assertEquals(entry.component, "hosted-lifecycle");
    assertEquals(
      entry.message,
      "Hosted lifecycle terminal hooks failed while preserving execution error",
    );
    assertEquals(entry.level, "debug");
    assertEquals(entry.context?.terminalStatus, "failed");
    assertEquals(entry.context?.terminalErrorCode, "STREAM_ERROR");
  });
});
