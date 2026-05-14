import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
        return Promise.reject(new Error("tooling failed"));
      },
      closeRuntime: () => {
        calls.push("runtime");
        return Promise.reject(new Error("runtime failed"));
      },
    });

    assertEquals(calls, ["reasoning", "text", "tooling", "runtime"]);
  });
});
