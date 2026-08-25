import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { FakeTime } from "#std/testing/time";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createConversationRunStreamMirror } from "./run-stream-mirror.ts";
import { type ConversationRunEventQueueController } from "./durable.ts";
import { ConversationRunEventEncoder } from "./run-events.ts";

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
      encoder: new ConversationRunEventEncoder(),
    });

    mirror.handleStreamEvent({ type: "text-start", id: "msg-1" });
    mirror.handleStreamEvent({ type: "text-delta", id: "msg-1", delta: "hello" });

    assertEquals(controller.enqueued, [
      [{ type: "TEXT_MESSAGE_START", messageId: "msg-1", contentId: "text:0", role: "assistant" }],
      [{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", contentId: "text:0", delta: "hello" }],
    ]);
    mirror.dispose();
  });

  it("stamps elapsed and epoch time with its default run-scoped encoder", () => {
    const controller = createMockQueueController();
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 10,
    });

    mirror.handleStreamEvent({ type: "text-start", id: "msg-1" });

    const event = controller.enqueued[0]?.[0] as
      | { elapsedMs?: number; emittedAt?: number }
      | undefined;
    assertEquals(
      typeof event?.elapsedMs === "number" && Number.isFinite(event.elapsedMs) &&
        event.elapsedMs >= 0,
      true,
    );
    assertEquals(
      typeof event?.emittedAt === "number" && Number.isInteger(event.emittedAt) &&
        event.emittedAt > 0,
      true,
    );
    mirror.dispose();
  });

  it("normalizes already-encoded events before enqueueing them", () => {
    const controller = createMockQueueController();
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 10,
      encoder: new ConversationRunEventEncoder(),
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

  it("stamps external events before and after normalization", () => {
    const controller = createMockQueueController();
    // Each clock reads later than the one before it, so the stamp taken before
    // normalization and the stamp taken after it carry distinguishable values.
    let nowReads = 0;
    let epochReads = 0;
    const mirror = createConversationRunStreamMirror({
      queueController: controller,
      immediateFlushEventCount: 10,
      encoder: new ConversationRunEventEncoder({
        startedMs: 100,
        nowMs: () => {
          nowReads += 1;
          return nowReads === 1 ? 142 : 242;
        },
        epochMs: () => {
          epochReads += 1;
          return epochReads === 1 ? 1_042 : 1_142;
        },
      }),
    });

    mirror.appendEvents([
      { type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) },
      { type: "STATE_SNAPSHOT", snapshot: { blob: "y".repeat(300 * 1024) } },
      { type: "TOOL_EXPOSURE_CHECKPOINT", elapsedMs: 7, emittedAt: 8 },
    ]);

    const normalized = controller.enqueued[0] as Array<{
      type: string;
      truncated?: boolean;
      elapsedMs?: number;
      emittedAt?: number;
    }>;
    const splitParts = normalized.filter((event) => event.type === "TEXT_MESSAGE_CONTENT");
    assertEquals(splitParts.length > 1, true, "the oversized text event must be split into parts");
    assertEquals(
      splitParts.every((event) => event.elapsedMs === 42 && event.emittedAt === 1_042),
      true,
      "split parts must keep the stamp taken before normalization",
    );

    const summarized = normalized.find((event) => event.type === "STATE_SNAPSHOT");
    assertEquals(summarized?.truncated, true, "the oversized generic event must be summarized");
    assertEquals(
      { elapsedMs: summarized?.elapsedMs, emittedAt: summarized?.emittedAt },
      { elapsedMs: 142, emittedAt: 1_142 },
      "events rebuilt by normalization must still be stamped",
    );

    assertEquals(normalized.at(-1), {
      type: "TOOL_EXPOSURE_CHECKPOINT",
      elapsedMs: 7,
      emittedAt: 8,
    });
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
