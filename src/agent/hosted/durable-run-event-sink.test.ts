import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { createGenerateModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import {
  createDurableRunEventSink,
  DurableRunEventPersistenceError,
} from "./durable-run-event-sink.ts";

function snapshot(
  overrides: Partial<ConversationRunMirrorSnapshot> = {},
): ConversationRunMirrorSnapshot {
  return {
    latestEventId: 1,
    latestExternalEventSequence: 0,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: false,
    hasFlushTimer: false,
    hasRetryTimer: false,
    inFlight: false,
    ...overrides,
  };
}

function mirror(input: {
  append?: (events: unknown[]) => Promise<void>;
  flush?: () => Promise<ConversationRunMirrorSnapshot>;
} = {}) {
  const appended: unknown[][] = [];
  let disposed = false;
  const result: ConversationRunChunkMirror = {
    handleChunk: async () => {},
    appendEvents: async (events) => {
      appended.push(events);
      await input.append?.(events);
    },
    flush: input.flush ?? (async () => snapshot()),
    getSnapshot: () => snapshot(),
    dispose: () => {
      disposed = true;
    },
  };
  return { result, appended, isDisposed: () => disposed };
}

describe("agent/hosted/durable-run-event-sink", () => {
  it("appends and flushes one direct event without chunk metadata", async () => {
    const target = mirror();
    const order: string[] = [];
    const sink = createDurableRunEventSink({
      mirror: {
        ...target.result,
        appendEvents: async (events) => {
          order.push("append");
          await target.result.appendEvents(events);
        },
        flush: async () => {
          order.push("flush");
          return snapshot();
        },
      },
    });
    const event = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "Use available skills." }],
      tools: [{ type: "function", name: "search", inputSchema: { type: "object" } }],
    };

    await sink(event);

    assertEquals(order, ["append", "flush"]);
    assertEquals(target.appended, [[event]]);
    for (
      const field of [
        "contextId",
        "partIndex",
        "partCount",
        "totalByteLength",
        "sha256",
        "serializedSegment",
      ]
    ) {
      assertEquals(field in event, false);
    }
  });

  it("persists a direct context above 2 MiB as one unchanged event", async () => {
    const target = mirror();
    const event = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "user", content: "x".repeat(2 * 1024 * 1024 + 1) }],
    };

    await createDurableRunEventSink({ mirror: target.result })(event);

    assertEquals(target.appended, [[event]]);
  });

  it("rejects append failures and a request over the general body limit", async () => {
    const appendFailure = mirror({ append: () => Promise.reject(new Error("append failed")) });
    await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: appendFailure.result })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      Error,
      "append failed",
    );
    assertEquals(appendFailure.isDisposed(), true);

    const oversized = mirror();
    let dispatches = 0;
    const model = createGenerateModel("test", "test/oversized-context", async () => {
      dispatches += 1;
      return { content: [], finishReason: "stop", usage: {} };
    });
    await assertRejects(
      async () =>
        await runWithRunEventSink(
          createDurableRunEventSink({ mirror: oversized.result }),
          () =>
            generateText({
              model,
              messages: [{ role: "user", content: "x".repeat(10 * 1024 * 1024) }],
            }),
        ),
      DurableRunEventPersistenceError,
      "Run event append request exceeds the supported payload size",
    );
    assertEquals(oversized.appended, []);
    assertEquals(dispatches, 0);
  });
});
