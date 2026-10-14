import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  AgentRunEvent,
  AgentRunEventSink,
  AgentRunModelCallContextEvent,
} from "#veryfront/runtime/model-call-context.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { DurableRunEventPersistenceError } from "#veryfront/agent/conversation/private-run-event.ts";
import {
  registerVeryfrontCloudModelFacts,
  type VeryfrontCloudModelFacts,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { createTimedAgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import { generateText } from "#veryfront/runtime/runtime-bridge.ts";
import { createGenerateModel } from "#veryfront/runtime/runtime-bridge.test-helpers.ts";

function isModelCallContextEvent(
  event: AgentRunEvent | undefined,
): event is AgentRunModelCallContextEvent {
  return event?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
}

function assertModelCallContextEvent(
  event: AgentRunEvent | undefined,
): asserts event is AgentRunModelCallContextEvent {
  assertEquals(isModelCallContextEvent(event), true);
}

function bindTestRuntimeObservationWriter(input: {
  sink: AgentRunEventSink;
  runId: string;
  canonicalRunId: string;
  projectId: string;
}): void {
  bindRuntimeObservationWriterCapability(
    input.sink,
    createRuntimeObservationWriterCapability({
      scope: {
        runId: input.runId,
        canonicalRunId: input.canonicalRunId,
        projectId: input.projectId,
      },
    }),
  );
}

function registerVeryfrontCloudTestModel(model: ModelRuntime): ModelRuntime {
  const facts = {
    provider: "openai",
    surface: "openai",
    native: true,
    transportPlan: { transport: "chat-completions", pinned: true },
  } satisfies VeryfrontCloudModelFacts;
  registerVeryfrontCloudModelFacts(model, () => facts);
  return model;
}

function withPatchedTimingIntrinsics(callback: () => void | Promise<void>): Promise<void> | void {
  const originalPerformance = globalThis.performance;
  const originalDateNow = Date.now;
  const originalRound = Math.round;
  const originalMax = Math.max;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => 9_007_199_254_740_991 },
  });
  Date.now = () => 123;
  Math.round = () => 777;
  Math.max = () => 888;
  const restore = () => {
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: originalPerformance,
    });
    Date.now = originalDateNow;
    Math.round = originalRound;
    Math.max = originalMax;
  };
  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe("model-call context timing intrinsic boundaries", () => {
  it("uses captured timing operations when globals are replaced", () => {
    return withPatchedTimingIntrinsics(() => {
      const explicitEvents: AgentRunEvent[] = [];
      createTimedAgentRunEventSink((event) => {
        explicitEvents.push(event);
      }, {
        nowMs: () => 42.6,
        epochMs: () => 1234.6,
        startedMs: 0,
      })({ type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED", messages: [] });
      assertEquals(
        explicitEvents.map(({ elapsedMs, emittedAt }) => ({ elapsedMs, emittedAt })),
        [{ elapsedMs: 43, emittedAt: 1235 }],
      );

      const defaultEvents: AgentRunEvent[] = [];
      createTimedAgentRunEventSink((event) => {
        defaultEvents.push(event);
      }, { startedMs: 0 })(
        { type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED", messages: [] },
      );
      assertEquals(defaultEvents[0]?.elapsedMs === 888, false, "patched Math.max must not run");
      assertEquals(defaultEvents[0]?.elapsedMs === 9_007_199_254_740_991, false);
      assertEquals(defaultEvents[0]?.emittedAt === 777, false, "patched Math.round must not run");
      assertEquals(defaultEvents[0]?.emittedAt === 123, false, "patched Date.now must not run");
    });
  });

  it("persists mandatory model context and dispatches through captured timing operations", async () => {
    await withPatchedTimingIntrinsics(async () => {
      const events: AgentRunEvent[] = [];
      let dispatches = 0;
      const model = createGenerateModel("test", "test/captured-timing-intrinsics", async () => {
        dispatches += 1;
        return { content: [{ type: "text", text: "ok" }], finishReason: "stop", usage: {} };
      });

      const result = await runWithMandatoryRunEventSink(
        (event) => {
          events.push(event);
        },
        () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
      );

      assertEquals(result.text, "ok");
      assertEquals(dispatches, 1);
      assertEquals(events.length, 1);
      assertEquals(events[0]?.type, "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
      assertEquals(events[0]?.elapsedMs === 888, false, "patched Math.max must not run");
      assertEquals(events[0]?.elapsedMs === 9_007_199_254_740_991, false);
      assertEquals(events[0]?.emittedAt === 777, false, "patched Math.round must not run");
      assertEquals(events[0]?.emittedAt === 123, false, "patched Date.now must not run");
    });
  });

  it("keeps exact Veryfront Cloud capture validation isolated from Array iteration hooks", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const canonicalRunId = "22222222-2222-4222-8222-222222222222";
    let recordedEvent: AgentRunEvent | undefined;
    let dispatches = 0;
    const sink: AgentRunEventSink = (event) => {
      assertModelCallContextEvent(event);
      recordedEvent = event;
      if (!event.modelCallId) throw new Error("expected model call id");
      return {
        eventId: "9007199254740993",
        projectId,
        runId: canonicalRunId,
        modelCallId: event.modelCallId,
      };
    };
    bindTestRuntimeObservationWriter({
      sink,
      runId: "33333333-3333-4333-8333-333333333333",
      canonicalRunId,
      projectId,
    });
    const model = registerVeryfrontCloudTestModel(
      createGenerateModel(
        "veryfront-cloud",
        "veryfront-cloud/openai/gpt-test",
        async () => {
          dispatches += 1;
          return { content: [{ type: "text", text: "done" }], finishReason: "stop", usage: {} };
        },
      ),
    );

    const originalArrayIterator = Array.prototype[Symbol.iterator];
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("patched array iterator");
      },
    });
    try {
      await runWithMandatoryRunEventSink(
        sink,
        () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
      );
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
    }

    assertModelCallContextEvent(recordedEvent);
    assertEquals(typeof recordedEvent.modelCallId, "string");
    assertEquals(dispatches, 1);
  });

  it("validates mandatory Veryfront Cloud capture receipts without mutable RegExp hooks", async () => {
    const projectId = "11111111-1111-7111-8111-111111111111";
    const canonicalRunId = "22222222-2222-7222-8222-222222222222";
    let recordedEvent: AgentRunEvent | undefined;
    let dispatches = 0;
    const sink: AgentRunEventSink = (event) => {
      assertModelCallContextEvent(event);
      recordedEvent = event;
      if (!event.modelCallId) throw new Error("expected model call id");
      return {
        eventId: "9007199254740993",
        projectId,
        runId: canonicalRunId,
        modelCallId: event.modelCallId,
      };
    };
    bindTestRuntimeObservationWriter({
      sink,
      runId: "33333333-3333-4333-8333-333333333333",
      canonicalRunId,
      projectId,
    });
    const model = registerVeryfrontCloudTestModel(
      createGenerateModel(
        "veryfront-cloud",
        "veryfront-cloud/openai/gpt-test",
        async () => {
          dispatches += 1;
          return { content: [{ type: "text", text: "done" }], finishReason: "stop", usage: {} };
        },
      ),
    );

    const originalRegExpExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function (): RegExpExecArray | null {
      throw new Error("patched RegExp.exec");
    };
    try {
      await runWithMandatoryRunEventSink(
        sink,
        () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
      );
    } finally {
      RegExp.prototype.exec = originalRegExpExec;
    }

    assertModelCallContextEvent(recordedEvent);
    assertEquals(dispatches, 1);
  });

  it("fails exact Veryfront Cloud capture when Array iteration tries to hide unsupported controls", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const canonicalRunId = "22222222-2222-4222-8222-222222222222";
    let sinkCalls = 0;
    let dispatches = 0;
    const sink: AgentRunEventSink = (event) => {
      assertModelCallContextEvent(event);
      sinkCalls += 1;
      return {
        eventId: "9007199254740993",
        projectId,
        runId: canonicalRunId,
        modelCallId: event.modelCallId ?? "33333333-3333-4333-8333-333333333333",
      };
    };
    bindTestRuntimeObservationWriter({
      sink,
      runId: "33333333-3333-4333-8333-333333333333",
      canonicalRunId,
      projectId,
    });
    const model = registerVeryfrontCloudTestModel(
      createGenerateModel(
        "veryfront-cloud",
        "veryfront-cloud/openai/gpt-test",
        async () => {
          dispatches += 1;
          return { content: [], finishReason: "stop", usage: {} };
        },
      ),
    );

    const originalArrayIterator = Array.prototype[Symbol.iterator];
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value: function* (this: unknown[]) {
        for (let index = 0; index < this.length; index++) {
          const value = this[index];
          if (value === "headers" || value === "providerOptions") continue;
          yield value;
        }
      },
    });
    try {
      await assertRejects(
        async () =>
          await runWithMandatoryRunEventSink(
            sink,
            async () =>
              await generateText({
                model,
                messages: [{ role: "user", content: "Hello" }],
                headers: { authorization: "Bearer private" },
                providerOptions: { "veryfront-cloud": { extra: true } },
              }),
          ),
        DurableRunEventPersistenceError,
        "Exact model call capture does not support these provider controls: headers, providerOptions",
      );
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalArrayIterator,
      });
    }

    assertEquals(sinkCalls, 0);
    assertEquals(dispatches, 0);
  });

  it("records a sanitized synchronous generate throw with captured promise operations", async () => {
    const events: AgentRunEvent[] = [];
    const privateDetail = "private sync generate detail";
    const promiseResolve = Promise.resolve;
    const model: ModelRuntime = {
      provider: "test",
      modelId: "test/sanitized-sync-generate-failure",
      specificationVersion: "v3",
      doGenerate: () => {
        throw new Error(privateDetail);
      },
      doStream: () => {
        throw new Error("unused stream path");
      },
    };

    Object.defineProperty(Promise, "resolve", {
      configurable: true,
      value: () => {
        throw new Error("patched Promise.resolve must not run");
      },
    });
    try {
      let rejected: unknown;
      try {
        await runWithMandatoryRunEventSink(
          (event) => {
            events.push(event);
          },
          () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
        );
      } catch (error) {
        rejected = error;
      }
      assertEquals(rejected instanceof Error ? rejected.message : undefined, privateDetail);
    } finally {
      Object.defineProperty(Promise, "resolve", { configurable: true, value: promiseResolve });
    }

    assertEquals(events.map((event) => event.type), [
      "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
      "RUNTIME_EVENT_RECORDED",
    ]);
    assertEquals(events[1], {
      type: "RUNTIME_EVENT_RECORDED",
      runtime: "veryfront",
      kind: "agent_error",
      value: { message: "Provider stream failed" },
    });
    assertEquals(JSON.stringify(events).includes(privateDetail), false);
  });
});
