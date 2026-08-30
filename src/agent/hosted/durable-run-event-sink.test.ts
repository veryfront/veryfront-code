import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import { ConversationRunEventEncoder } from "../conversation/run-events.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { createGenerateModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import {
  type AgentRunModelCallContextEvent,
  createAgentRunEventTimingAnchor,
} from "../../runtime/model-call-context.ts";
import {
  getPrivateRunEventAppendRequestByteLength,
  MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
  MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
} from "../conversation/run-event-limits.ts";
import { isPrivateConversationRunEvent } from "../conversation/private-run-event.ts";
import { prepareConversationRunExternalEvents } from "../conversation/run-event-preparation.ts";
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

function firstAppendedEvent(appended: unknown[][]): Record<string, unknown> {
  const batch = appended[0];
  if (!batch || batch[0] === undefined) {
    throw new Error("expected an appended event");
  }
  return batch[0] as Record<string, unknown>;
}

function leadingNoticeText(event: Record<string, unknown>): string {
  const messages = event.messages as Array<Record<string, unknown>> | undefined;
  const text = messages?.[0]?.content;
  if (typeof text !== "string") {
    throw new Error("expected a leading notice message");
  }
  return text;
}

function createModelCallContextEventWithText(
  textLength: number,
): AgentRunModelCallContextEvent {
  return {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT",
    messages: [{
      role: "user",
      content: [{ type: "text", text: "x".repeat(textLength) }],
    }],
  };
}

describe("agent/hosted/durable-run-event-sink", () => {
  it("uses one run anchor for public and private event families", async () => {
    let now = 100;
    const timing = createAgentRunEventTimingAnchor({
      nowMs: () => now,
      epochMs: () => 1_786_866_357_364,
    });
    const target = mirror();
    const publicEncoder = new ConversationRunEventEncoder(timing);
    now = 142;
    publicEncoder.encode({ type: "start", messageId: "message-1" });
    const publicEvent = publicEncoder.encode({ type: "text-start", id: "text:0" })[0];
    await createDurableRunEventSink({ mirror: target.result, timing })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
    });
    const privateEvent = firstAppendedEvent(target.appended);
    assertEquals(publicEvent?.elapsedMs, 42);
    assertEquals(privateEvent.elapsedMs, 42);
    assertEquals(publicEvent?.emittedAt, privateEvent.emittedAt);
  });

  it("appends and flushes one direct event with default producer timing", async () => {
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
    const event: AgentRunModelCallContextEvent = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "Use available skills." }],
      tools: [{ type: "function", name: "search", inputSchema: { type: "object" } }],
    };

    await sink(event);

    assertEquals(order, ["append", "flush"]);
    const persisted = firstAppendedEvent(target.appended);
    assertEquals(persisted.type, event.type);
    assertEquals(persisted.messages, event.messages);
    assertEquals(persisted.tools, event.tools);
    assertEquals(
      typeof persisted.elapsedMs === "number" && persisted.elapsedMs >= 0,
      true,
      "an absent timing option still stamps nonnegative elapsedMs",
    );
    assertEquals(
      typeof persisted.emittedAt === "number" && Number.isInteger(persisted.emittedAt),
      true,
      "an absent timing option still stamps an epoch timestamp",
    );
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
      assertEquals(
        field in persisted,
        false,
        `${field} must not be stamped on a direct persisted event`,
      );
    }
  });

  it("preserves valid producer timing instead of replacing it", async () => {
    const target = mirror();
    const sink = createDurableRunEventSink({
      mirror: target.result,
      timing: {
        nowMs: () => 900,
        startedMs: 100,
        epochMs: () => 1_900_000_000_000,
      },
    });

    await sink({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
      elapsedMs: 42,
      emittedAt: 1_786_866_357_364,
    });

    const persisted = firstAppendedEvent(target.appended);
    assertEquals(persisted.elapsedMs, 42);
    assertEquals(persisted.emittedAt, 1_786_866_357_364);
  });

  it("persists a direct context above 2 MiB as one unchanged event", async () => {
    const target = mirror();
    const event = createModelCallContextEventWithText(
      MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES + 1,
    );

    await createDurableRunEventSink({
      mirror: target.result,
      timing: {
        nowMs: () => 100,
        startedMs: 100,
        epochMs: () => 1_786_866_357_364,
      },
    })(event);

    assertEquals(target.appended, [[{
      ...event,
      elapsedMs: 0,
      emittedAt: 1_786_866_357_364,
    }]]);
  });

  it("accepts the exact append request byte limit and rejects one byte over", async () => {
    const baseEvent = {
      ...createModelCallContextEventWithText(0),
      model: { id: "claude-sonnet-4-6", modelProvider: "anthropic" },
      request: { maxOutputTokens: 4096 },
      elapsedMs: 42,
      emittedAt: 1_786_866_357_364,
    };
    const exactTextLength = MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES -
      getPrivateRunEventAppendRequestByteLength(baseEvent);
    const exactEvent = {
      ...baseEvent,
      messages: [{
        role: "user" as const,
        content: [{ type: "text" as const, text: "x".repeat(exactTextLength) }],
      }],
    };
    assertEquals(
      getPrivateRunEventAppendRequestByteLength(exactEvent),
      MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
    );

    const exactTarget = mirror();
    await createDurableRunEventSink({ mirror: exactTarget.result })(exactEvent);
    assertEquals(exactTarget.appended, [[exactEvent]]);

    const oversizedTarget = mirror();
    const oversizedEvent = {
      ...baseEvent,
      messages: [{
        role: "user" as const,
        content: [{ type: "text" as const, text: "x".repeat(exactTextLength + 1) }],
      }],
    };
    await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: oversizedTarget.result })(oversizedEvent),
      DurableRunEventPersistenceError,
      "Run event append request exceeds the supported payload size",
    );

    // The gate still refuses the dispatch, but the attempt is now on the record.
    assertEquals(
      oversizedTarget.appended.length,
      1,
      "a truncated record is persisted for audit before the gate throws",
    );
    const persisted = firstAppendedEvent(oversizedTarget.appended);
    assertEquals(persisted.model, baseEvent.model);
    assertEquals(persisted.request, baseEvent.request);
    assertEquals(persisted.elapsedMs, 42);
    assertEquals(persisted.emittedAt, 1_786_866_357_364);
    assertEquals(
      getPrivateRunEventAppendRequestByteLength(persisted) <=
        MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
      true,
      "the persisted record fits the append budget",
    );
    assertEquals(
      isPrivateConversationRunEvent(persisted),
      true,
      "the reduced record must still satisfy the private-event shape, or the real mirror " +
        "would throw on append and dispose the mirror — the very loss this fixes",
    );
    const noticeText = leadingNoticeText(persisted);
    assertEquals(
      noticeText.includes("truncated for audit"),
      true,
      "the record leads with a notice saying it is an excerpt",
    );
    assertEquals(
      noticeText.includes("not the context that was sent"),
      true,
      "the notice denies that it is a faithful record",
    );
  });

  it("survives the real normalization path used by the production mirror", async () => {
    const target = mirror();
    await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: target.result })(
          createModelCallContextEventWithText(MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES),
        ),
      DurableRunEventPersistenceError,
    );

    // prepareConversationRunExternalEvents is what the hosted mirror actually runs
    // on append; it throws "Invalid private run event shape" for any unexpected
    // top-level key, which this sink would treat as a persistence failure.
    const normalized = prepareConversationRunExternalEvents([
      firstAppendedEvent(target.appended) as never,
    ]);
    assertEquals(normalized.length, 1, "the reduced record normalizes to exactly one event");
  });

  it("keeps the mirror usable after an oversized context is refused", async () => {
    const target = mirror();
    const sink = createDurableRunEventSink({ mirror: target.result });

    await assertRejects(
      async () =>
        await sink(
          createModelCallContextEventWithText(MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES),
        ),
      DurableRunEventPersistenceError,
    );
    assertEquals(target.isDisposed(), false, "one oversized context must not disable the mirror");

    await sink(createModelCallContextEventWithText(16));
    assertEquals(
      target.appended.length,
      2,
      "later events in the same run still persist",
    );
  });

  it("explains the refusal in terms an operator can act on", async () => {
    const target = mirror();
    const error = await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: target.result })(
          createModelCallContextEventWithText(MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES),
        ),
      DurableRunEventPersistenceError,
    );

    assertInstanceOf(error, DurableRunEventPersistenceError);
    const message = error.message;
    assertEquals(message.includes("MiB"), true, "the message states the size and the limit");
    assertEquals(
      message.includes("was not dispatched"),
      true,
      "the message says the model call did not happen",
    );
    assertEquals(
      message.includes("truncated record was persisted"),
      true,
      "the message points at the audit record that was written",
    );
  });

  it("guarantees a fit when message count alone exceeds the budget", async () => {
    const target = mirror();
    const event = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: Array.from({ length: 120_000 }, () => ({
        role: "user",
        content: [{ type: "text", text: "y".repeat(80) }],
      })),
    } as unknown as Parameters<ReturnType<typeof createDurableRunEventSink>>[0];

    await assertRejects(
      async () => await createDurableRunEventSink({ mirror: target.result })(event),
      DurableRunEventPersistenceError,
    );

    const persisted = firstAppendedEvent(target.appended);
    assertEquals(
      getPrivateRunEventAppendRequestByteLength(persisted) <=
        MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
      true,
      "clamping text cannot help here, so messages must be dropped until it fits",
    );
    assertEquals(
      isPrivateConversationRunEvent(persisted),
      true,
      "the reduced record still satisfies the private-event shape",
    );
    const noticeText = leadingNoticeText(persisted);
    assertEquals(
      /\b[1-9]\d* message\(s\) omitted/.test(noticeText),
      true,
      "the notice states how many messages were dropped",
    );
  });

  it("serializes concurrent events that share a durable mirror", async () => {
    const firstAppendStarted = Promise.withResolvers<void>();
    const releaseFirstAppend = Promise.withResolvers<void>();
    const order: string[] = [];
    let pendingEventCount = 0;
    const getSnapshot = () => snapshot({ pendingEventCount });
    const target: ConversationRunChunkMirror = {
      handleChunk: async () => {},
      appendEvents: async (events) => {
        const content = (events[0] as unknown as {
          messages: [{ content: string }];
        }).messages[0].content;
        order.push(`append:${content}`);
        if (content === "first") {
          firstAppendStarted.resolve();
          await releaseFirstAppend.promise;
        }
        pendingEventCount += events.length;
      },
      flush: async () => {
        order.push("flush");
        pendingEventCount = 0;
        return getSnapshot();
      },
      getSnapshot,
      dispose: () => {},
    };
    const first = createDurableRunEventSink({ mirror: target })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "first" }],
    });
    await firstAppendStarted.promise;
    const second = createDurableRunEventSink({ mirror: target })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "second" }],
    });

    releaseFirstAppend.resolve();
    await Promise.all([first, second]);

    assertEquals(order, ["append:first", "flush", "append:second", "flush"]);
  });

  it("reports the concrete disable reason when a required mirror is already disabled", async () => {
    for (
      const disableReason of [
        "auth_rejected",
        "payload_too_large",
      ] as const
    ) {
      const target = mirror();
      const error = await assertRejects(
        async () =>
          await createDurableRunEventSink({
            mirror: {
              ...target.result,
              getSnapshot: () => snapshot({ disabled: true, disableReason }),
            },
          })({
            type: "AGENT_RUN_MODEL_CALL_CONTEXT",
            messages: [],
          }),
        DurableRunEventPersistenceError,
        disableReason,
      );

      assertInstanceOf(error, DurableRunEventPersistenceError);
      assertEquals(
        String(error.detail).includes(disableReason),
        true,
        "structured VeryfrontError detail should expose the durable mirror disable reason",
      );
    }
  });

  it("treats a mirror already stopped by a terminal run as cancellation, not a failure", async () => {
    // veryfront-issue-inbox#872 (Sentry VERYFRONT-AGENT-7): `run_terminal` means
    // the API already told the mirror the run is finished server-side (a project
    // delete cancels its in-flight runs first, see veryfront-issue-inbox#743).
    // Nothing the runtime can still write is lost, so every other consumer of the
    // reason treats it as a clean stop. The sink must do the same: the model
    // dispatch is still refused, but as the runtime's abort shape rather than the
    // DurableRunEventPersistenceError that pages an operator for a run that
    // simply no longer exists.
    const target = mirror();
    const error = await assertRejects(
      async () =>
        await createDurableRunEventSink({
          mirror: {
            ...target.result,
            getSnapshot: () => snapshot({ disabled: true, disableReason: "run_terminal" }),
          },
        })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DOMException,
      undefined,
      "a terminal-run stop must refuse the dispatch as a cancellation, not a persistence failure",
    );

    assertInstanceOf(error, DOMException);
    assertEquals(
      error.name,
      "AbortError",
      "the runtime recognizes DOMException AbortError as a clean cancellation",
    );
    assertEquals(
      target.appended.length,
      0,
      "nothing can be appended to a run that is already terminal",
    );
  });

  it("treats a run turning terminal during persistence as cancellation, not a failure", async () => {
    // The production path behind the Sentry group: the append attempt is rejected
    // with a terminal-run error, recovery disables the mirror with reason
    // `run_terminal`, and the post-append flush hands that snapshot back to the
    // sink. The persisted context is not lost and the run is finished, so the
    // sink must wind down as a cancellation instead of raising
    // "Required durable run event mirror is disabled: run_terminal".
    const target = mirror({
      flush: async () => snapshot({ disabled: true, disableReason: "run_terminal" }),
    });
    const error = await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: target.result })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DOMException,
      undefined,
      "a run that turns terminal mid-persistence must reject as a cancellation",
    );

    assertInstanceOf(error, DOMException);
    assertEquals(
      error.name,
      "AbortError",
      "the runtime recognizes DOMException AbortError as a clean cancellation",
    );
    assertEquals(
      target.appended.length,
      1,
      "the context was appended before the run was discovered to be terminal",
    );
  });

  it("does not mask later persistence failures with a rejected tail", async () => {
    const firstAppendStarted = Promise.withResolvers<void>();
    const releaseFirstAppend = Promise.withResolvers<void>();
    let secondAppendCount = 0;
    const target: ConversationRunChunkMirror = {
      handleChunk: async () => {},
      appendEvents: async (events) => {
        const content = (events[0] as unknown as {
          messages: [{ content: string }];
        }).messages[0].content;
        if (content === "first") {
          firstAppendStarted.resolve();
          await releaseFirstAppend.promise;
          throw new Error("first append failed");
        }
        secondAppendCount += 1;
        throw new Error("second append failed");
      },
      flush: async () => snapshot(),
      getSnapshot: () => snapshot(),
      dispose: () => {},
    };
    const first = createDurableRunEventSink({ mirror: target })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "first" }],
    });
    await firstAppendStarted.promise;
    const second = createDurableRunEventSink({ mirror: target })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "second" }],
    });

    releaseFirstAppend.resolve();
    await assertRejects(async () => await first, Error, "first append failed");
    await assertRejects(
      async () => await second,
      Error,
      "second append failed",
    );
    assertEquals(secondAppendCount, 1);
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
    // The fail-closed contract that matters: the model is never called when the
    // context could not be recorded faithfully. Only the audit record changed —
    // a truncated one is now written before the refusal.
    assertEquals(dispatches, 0);
    assertEquals(oversized.appended.length, 1);
    assertEquals(
      isPrivateConversationRunEvent(firstAppendedEvent(oversized.appended)),
      true,
      "the audit record stays a valid private event",
    );
    assertEquals(oversized.isDisposed(), false);
  });

  it("rejects caller aborts without a reason as AbortError", async () => {
    const controller = new AbortController();
    const target = mirror({
      append: () =>
        new Promise(() => {
          controller.abort();
        }),
    });

    const error = await assertRejects(
      async () =>
        await createDurableRunEventSink({
          mirror: target.result,
          abortSignal: controller.signal,
        })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DOMException,
    );

    assertInstanceOf(error, DOMException);
    assertEquals(error.name, "AbortError");
    assertEquals(target.isDisposed(), true);
  });

  it("fails closed when the post-append flush leaves events pending", async () => {
    const target = mirror({ flush: async () => snapshot({ pendingEventCount: 1 }) });

    await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: target.result })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DurableRunEventPersistenceError,
      "Required durable run event was not flushed",
      "pending events after flush must reject the model call",
    );
    assertEquals(target.appended.length, 1, "the event must still have been appended");
    assertEquals(
      target.isDisposed(),
      true,
      "mirror must be disposed after a failed required flush",
    );
  });

  it("fails closed when the post-append flush leaves a retry timer armed", async () => {
    const target = mirror({ flush: async () => snapshot({ hasRetryTimer: true }) });

    await assertRejects(
      async () =>
        await createDurableRunEventSink({ mirror: target.result })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DurableRunEventPersistenceError,
      "Required durable run event was not flushed",
      "an armed retry timer after flush must reject the model call",
    );
    assertEquals(
      target.isDisposed(),
      true,
      "mirror must be disposed after a failed required flush",
    );
  });

  it("fails closed when the mirror reports in-flight work after a drained flush", async () => {
    const target = mirror();
    let flushCount = 0;
    let disposed = false;

    await assertRejects(
      async () =>
        await createDurableRunEventSink({
          mirror: {
            ...target.result,
            flush: async () => {
              flushCount += 1;
              return snapshot();
            },
            getSnapshot: () => snapshot({ inFlight: flushCount > 0 }),
            dispose: () => {
              disposed = true;
            },
          },
        })({
          type: "AGENT_RUN_MODEL_CALL_CONTEXT",
          messages: [],
        }),
      DurableRunEventPersistenceError,
      "Required durable run event was not flushed",
      "in-flight work reported after a drained flush must reject the model call",
    );
    assertEquals(disposed, true, "mirror must be disposed after a failed required flush");
  });

  it("times out persistence that never settles", async () => {
    const target = mirror({
      append: () => new Promise(() => {}),
    });
    // Guard rail only: if the sink's own deadline never fires, this caller abort
    // turns a hang into a distinct AbortError rejection.
    const guard = new AbortController();
    const guardTimer = setTimeout(() => guard.abort(), 5_000);

    try {
      await assertRejects(
        async () =>
          await createDurableRunEventSink({
            mirror: target.result,
            timeoutMs: 1,
            abortSignal: guard.signal,
          })({
            type: "AGENT_RUN_MODEL_CALL_CONTEXT",
            messages: [],
          }),
        DurableRunEventPersistenceError,
        "Durable run event persistence timed out",
        "a mirror that never settles must hit the persistence deadline",
      );
    } finally {
      clearTimeout(guardTimer);
    }
    assertEquals(target.isDisposed(), true, "mirror must be disposed after a persistence timeout");
  });

  it("uses a registered VeryfrontError for durable persistence failures", () => {
    const error = new DurableRunEventPersistenceError("persistence unavailable");

    assertInstanceOf(error, DurableRunEventPersistenceError);
    assertEquals(error.slug, "durable-run-event-persistence-failed");
    assertEquals(error.category, "AGENT");
    assertEquals(error.detail, "persistence unavailable");
  });
});
