import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { FakeTime } from "jsr:@std/testing@1.0.17/time";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createConversationRunStreamMirror } from "./run-stream-mirror.ts";
import { type ConversationRunEventQueueController } from "./durable.ts";

function createMockQueueController(initial?: {
  latestEventId?: number;
  latestExternalEventSequence?: number;
  pendingEventCount?: number;
  consecutiveFailures?: number;
  disabled?: boolean;
  flushImpl?: ConversationRunEventQueueController["flush"];
}) {
  let latestEventId = initial?.latestEventId ?? 0;
  let latestExternalEventSequence = initial?.latestExternalEventSequence ?? 0;
  let pendingEventCount = initial?.pendingEventCount ?? 0;
  let consecutiveFailures = initial?.consecutiveFailures ?? 0;
  let disabled = initial?.disabled ?? false;
  const enqueued: unknown[][] = [];

  const controller: ConversationRunEventQueueController & { enqueued: unknown[][] } = {
    enqueue(events) {
      enqueued.push(events);
      pendingEventCount += events.length;
    },
    async flush() {
      if (initial?.flushImpl) {
        const flushed = await initial.flushImpl();
        latestEventId = flushed.latestEventId;
        latestExternalEventSequence = flushed.latestExternalEventSequence;
        pendingEventCount = flushed.pendingEventCount;
        consecutiveFailures = flushed.consecutiveFailures;
        disabled = flushed.disabled;
        return flushed;
      }

      pendingEventCount = 0;
      consecutiveFailures = 0;
      return {
        outcome: "flushed" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount,
        consecutiveFailures,
        disabled,
      };
    },
    getSnapshot() {
      return {
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount,
        consecutiveFailures,
        disabled,
      };
    },
    enqueued,
  };

  return controller;
}

describe("agent/conversation-run-stream-mirror", () => {
  it("encodes stream events before enqueueing them", () => {
    const controller = createMockQueueController();
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
    });

    mirror.handleStreamEvent({ type: "text-start", id: "msg-1" });
    mirror.handleStreamEvent({ type: "text-delta", id: "msg-1", delta: "hello" });

    assertEquals(controller.enqueued, [
      [{ type: "TEXT_MESSAGE_START", messageId: "msg-1", contentId: "text:0", role: "assistant" }],
      [{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", contentId: "text:0", delta: "hello" }],
    ]);
    mirror.dispose();
  });

  it("normalizes already-encoded events before enqueueing them", () => {
    const controller = createMockQueueController();
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 10,
    });

    mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) }]);

    assertEquals(controller.enqueued[0]!.length > 1, true);
    assertEquals(
      controller.enqueued[0]!.every((event) =>
        (event as { type: string }).type === "TEXT_MESSAGE_CONTENT"
      ),
      true,
    );
    mirror.dispose();
  });

  it("uses the underlying mirror retry scheduling path", async () => {
    using time = new FakeTime();
    const retryStates: Array<{ errorMessage: string; retryDelayMs: number }> = [];
    let flushCalls = 0;
    const controller = createMockQueueController({
      flushImpl: async () => {
        flushCalls += 1;
        if (flushCalls === 1) {
          return {
            outcome: "retry_scheduled" as const,
            latestEventId: 1,
            latestExternalEventSequence: 1,
            pendingEventCount: 1,
            consecutiveFailures: 1,
            disabled: false,
            errorMessage: "append failed",
          };
        }
        return {
          outcome: "flushed" as const,
          latestEventId: 2,
          latestExternalEventSequence: 2,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
        };
      },
    });
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 1,
      getRetryDelayMs: () => 250,
      onRetryScheduled: (state) => {
        retryStates.push({ errorMessage: state.errorMessage, retryDelayMs: state.retryDelayMs });
      },
    });

    mirror.handleStreamEvent({ type: "text-start", id: "msg-1" });
    await time.tickAsync(0);
    assertEquals(retryStates, [{ errorMessage: "append failed", retryDelayMs: 250 }]);
    await time.tickAsync(250);
    assertEquals(flushCalls, 2);
    mirror.dispose();
  });
});
