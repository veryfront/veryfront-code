import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { FakeTime } from "#std/testing/time";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ConversationRunMirrorHighBacklogState,
  type ConversationRunMirrorRetryScheduledState,
  type ConversationRunMirrorStoppedState,
  createConversationRunMirror,
} from "./run-mirror.ts";
import { type ConversationRunEventQueueController } from "./durable.ts";

function createMockQueueController(initial?: {
  latestEventId?: number;
  latestExternalEventSequence?: number;
  pendingEvents?: unknown[];
  consecutiveFailures?: number;
  disabled?: boolean;
  flushImpl?: ConversationRunEventQueueController["flush"];
}): ConversationRunEventQueueController & { enqueueCalls: unknown[][] } {
  let latestEventId = initial?.latestEventId ?? 0;
  let latestExternalEventSequence = initial?.latestExternalEventSequence ?? 0;
  let pendingEvents = [...(initial?.pendingEvents ?? [])];
  let consecutiveFailures = initial?.consecutiveFailures ?? 0;
  let disabled = initial?.disabled ?? false;
  const enqueueCalls: unknown[][] = [];

  const controller: ConversationRunEventQueueController & { enqueueCalls: unknown[][] } = {
    enqueue(events) {
      enqueueCalls.push(events);
      pendingEvents.push(...events);
    },
    async flush() {
      if (initial?.flushImpl) {
        const flushed = await initial.flushImpl();
        latestEventId = flushed.latestEventId;
        latestExternalEventSequence = flushed.latestExternalEventSequence;
        if (flushed.outcome === "retry_scheduled") {
          pendingEvents = Array.from(
            { length: flushed.pendingEventCount },
            () => ({ type: "pending" }),
          );
          consecutiveFailures = flushed.consecutiveFailures;
        } else {
          pendingEvents = [];
          consecutiveFailures = flushed.consecutiveFailures;
          disabled = flushed.disabled;
        }
        return flushed;
      }

      pendingEvents = [];
      consecutiveFailures = 0;
      return {
        outcome: "flushed" as const,
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: 0,
        consecutiveFailures,
        disabled,
      };
    },
    getSnapshot() {
      return {
        latestEventId,
        latestExternalEventSequence,
        pendingEventCount: pendingEvents.length,
        consecutiveFailures,
        disabled,
      };
    },
    enqueueCalls,
  };

  return controller;
}

describe("agent/conversation-run-mirror", () => {
  afterEach(() => {
    // no-op placeholder for bdd compatibility
  });

  it("starts an immediate flush when the queue reaches the immediate threshold", async () => {
    const controller = createMockQueueController();
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
    });

    mirror.enqueue([{ id: 1 }, { id: 2 }]);
    await mirror.flush();

    assertEquals(controller.enqueueCalls, [[{ id: 1 }, { id: 2 }]]);
    assertEquals(mirror.getSnapshot(), {
      latestEventId: 0,
      latestExternalEventSequence: 0,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
      hasFlushTimer: false,
      hasRetryTimer: false,
      inFlight: false,
    });
  });

  it("schedules a delayed flush for smaller batches", async () => {
    using time = new FakeTime();
    let flushCalls = 0;
    const controller = createMockQueueController({
      flushImpl: async () => {
        flushCalls += 1;
        return {
          outcome: "flushed" as const,
          latestEventId: 3,
          latestExternalEventSequence: 4,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
        };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
      flushDelayMs: 50,
    });

    mirror.enqueue([{ id: 1 }]);
    assertEquals(flushCalls, 0);
    await time.tickAsync(50);
    assertEquals(flushCalls, 1);
    assertEquals(mirror.getSnapshot(), {
      latestEventId: 3,
      latestExternalEventSequence: 4,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
      hasFlushTimer: false,
      hasRetryTimer: false,
      inFlight: true,
    });
  });

  it("surfaces retry scheduling through a host callback and retry timer", async () => {
    using time = new FakeTime();
    let flushCalls = 0;
    const retryStates: ConversationRunMirrorRetryScheduledState[] = [];
    const controller = createMockQueueController({
      flushImpl: async () => {
        flushCalls += 1;
        if (flushCalls === 1) {
          return {
            outcome: "retry_scheduled" as const,
            latestEventId: 2,
            latestExternalEventSequence: 3,
            pendingEventCount: 1,
            consecutiveFailures: 1,
            disabled: false,
            errorMessage: "append failed",
          };
        }

        return {
          outcome: "flushed" as const,
          latestEventId: 4,
          latestExternalEventSequence: 5,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
        };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
      flushDelayMs: 0,
      getRetryDelayMs: () => 250,
      onRetryScheduled: (state) => {
        retryStates.push(state);
      },
    });

    mirror.enqueue([{ id: 1 }, { id: 2 }]);
    await time.tickAsync(0);
    assertEquals(retryStates, [{
      outcome: "retry_scheduled",
      latestEventId: 2,
      latestExternalEventSequence: 3,
      pendingEventCount: 1,
      consecutiveFailures: 1,
      disabled: false,
      errorMessage: "append failed",
      retryDelayMs: 250,
    }]);
    assertEquals(mirror.getSnapshot().hasRetryTimer, true);

    await time.tickAsync(250);
    assertEquals(flushCalls, 2);
    assertEquals(mirror.getSnapshot().hasRetryTimer, false);
    assertEquals(mirror.getSnapshot().pendingEventCount, 0);
  });

  it("surfaces stopped outcomes through a host callback and clears timers", async () => {
    const stoppedStates: ConversationRunMirrorStoppedState[] = [];
    const controller = createMockQueueController({
      flushImpl: async () => ({
        outcome: "stopped" as const,
        latestEventId: 9,
        latestExternalEventSequence: 10,
        pendingEventCount: 0,
        consecutiveFailures: 2,
        disabled: true,
        disableReason: "non_appendable" as const,
      }),
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 1,
      onStopped: (state) => {
        stoppedStates.push(state);
      },
    });

    mirror.enqueue([{ id: 1 }]);
    await mirror.flush();

    assertEquals(stoppedStates, [{
      outcome: "stopped",
      latestEventId: 9,
      latestExternalEventSequence: 10,
      pendingEventCount: 0,
      consecutiveFailures: 2,
      disabled: true,
      disableReason: "non_appendable",
    }]);
    assertEquals(mirror.getSnapshot().disabled, true);
    assertEquals(mirror.getSnapshot().hasFlushTimer, false);
    assertEquals(mirror.getSnapshot().hasRetryTimer, false);
  });

  it("surfaces high backlog before a flush starts", async () => {
    const highBacklogStates: ConversationRunMirrorHighBacklogState[] = [];
    let flushCalls = 0;
    const controller = createMockQueueController({
      flushImpl: async () => {
        flushCalls += 1;
        return {
          outcome: "flushed" as const,
          latestEventId: 3,
          latestExternalEventSequence: 4,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
        };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 3,
      highBacklogEventCount: 2,
      onHighBacklog: (state) => {
        highBacklogStates.push(state);
      },
    });

    mirror.enqueue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await mirror.flush();

    assertEquals(flushCalls, 1);
    assertEquals(highBacklogStates, [{
      latestEventId: 0,
      latestExternalEventSequence: 0,
      pendingEventCount: 3,
      consecutiveFailures: 0,
      disabled: false,
      threshold: 2,
    }]);
  });
});
