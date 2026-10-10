import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentRunEvent } from "#veryfront/runtime/model-call-context.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { createTimedAgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { generateText } from "#veryfront/runtime/runtime-bridge.ts";
import { createGenerateModel } from "#veryfront/runtime/runtime-bridge.test-helpers.ts";

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
