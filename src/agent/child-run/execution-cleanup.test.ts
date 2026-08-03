import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  closeChildRunExecutionBuffers,
  finalizeChildRunExecutionResources,
} from "./execution-cleanup.ts";

describe("child-run-execution-cleanup", () => {
  it("closes reasoning before text buffers", async () => {
    const calls: string[] = [];

    await closeChildRunExecutionBuffers({
      closeReasoningBuffer: () => {
        calls.push("reasoning");
        return Promise.resolve();
      },
      closeTextBuffer: () => {
        calls.push("text");
        return Promise.resolve();
      },
    });

    assertEquals(calls, ["reasoning", "text"]);
  });

  it("appends the finish step only after durable work started", async () => {
    const calls: string[] = [];

    await finalizeChildRunExecutionResources({
      durableStepStarted: true,
      closeReasoningBuffer: () => {
        calls.push("reasoning");
        return Promise.resolve();
      },
      closeTextBuffer: () => {
        calls.push("text");
        return Promise.resolve();
      },
      appendFinishStepChunk: () => {
        calls.push("finish-step");
        return Promise.resolve();
      },
      flushMirror: () => {
        calls.push("flush");
        return Promise.resolve();
      },
    });

    assertEquals(calls, ["reasoning", "text", "finish-step", "flush"]);
  });

  it("skips the finish step when durable work never started", async () => {
    const calls: string[] = [];

    await finalizeChildRunExecutionResources({
      durableStepStarted: false,
      closeReasoningBuffer: () => {
        calls.push("reasoning");
        return Promise.resolve();
      },
      closeTextBuffer: () => {
        calls.push("text");
        return Promise.resolve();
      },
      appendFinishStepChunk: () => {
        calls.push("finish-step");
        return Promise.resolve();
      },
      flushMirror: () => {
        calls.push("flush");
        return Promise.resolve();
      },
    });

    assertEquals(calls, ["reasoning", "text", "flush"]);
  });

  it("settles tooling and runtime cleanup failures", async () => {
    const calls: string[] = [];
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      await finalizeChildRunExecutionResources({
        durableStepStarted: false,
        closeReasoningBuffer: () => {
          calls.push("reasoning");
          return Promise.resolve();
        },
        closeTextBuffer: () => {
          calls.push("text");
          return Promise.resolve();
        },
        appendFinishStepChunk: () => {
          calls.push("finish-step");
          return Promise.resolve();
        },
        closeTooling: () => {
          calls.push("tooling");
          return Promise.reject(new Error("tooling failed with <TOKEN>"));
        },
        closeRuntime: () => {
          calls.push("runtime");
          return Promise.reject(new Error("runtime failed at <LOCAL_PATH>"));
        },
      });
    } finally {
      __resetLogRecordEmitterForTests();
    }

    assertEquals(calls, ["reasoning", "text", "tooling", "runtime"]);
    assertEquals(entries.map((entry) => entry.context), [
      { errorName: "Error" },
      { errorName: "Error" },
    ]);
    assertEquals(JSON.stringify(entries).includes("<TOKEN>"), false);
    assertEquals(JSON.stringify(entries).includes("<LOCAL_PATH>"), false);
  });
});
