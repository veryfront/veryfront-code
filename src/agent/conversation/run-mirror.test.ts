import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

  it("waits through retry backoff when durable persistence requests a drain", async () => {
    using time = new FakeTime();
    let attempts = 0;
    const controller = createMockQueueController({
      pendingEvents: [{ type: "capture" }],
      flushImpl: async () => {
        attempts++;
        return attempts === 1
          ? {
            outcome: "retry_scheduled",
            latestEventId: 1,
            latestExternalEventSequence: 0,
            pendingEventCount: 1,
            consecutiveFailures: 1,
            disabled: false,
            errorMessage: "temporary network failure",
          }
          : {
            outcome: "flushed",
            latestEventId: 2,
            latestExternalEventSequence: 1,
            pendingEventCount: 0,
            consecutiveFailures: 0,
            disabled: false,
          };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
      getRetryDelayMs: () => 250,
    });
    const options = { abortSignal: new AbortController().signal, waitForRetries: true };
    let settled = false;
    const draining = mirror.flush(options).then((state) => {
      settled = true;
      return state;
    });
    try {
      await time.tickAsync(0);
      assertEquals(settled, false, "a scheduled retry is not a completed drain");
      await time.tickAsync(249);
      assertEquals(attempts, 1, "retain retry backoff");
      await time.tickAsync(1);
      assertEquals((await draining).pendingEventCount, 0);
      assertEquals(attempts, 2);
    } finally {
      mirror.dispose();
    }
  });

  it("shares retry backoff across concurrent drains and immediate enqueues", async () => {
    using time = new FakeTime();
    let attempts = 0;
    const mirror = createConversationRunMirror({
      queueController: createMockQueueController({
        pendingEvents: [{ type: "capture" }],
        flushImpl: async () => {
          attempts++;
          return attempts === 1
            ? {
              outcome: "retry_scheduled",
              latestEventId: 1,
              latestExternalEventSequence: 0,
              pendingEventCount: 1,
              consecutiveFailures: 1,
              disabled: false,
              errorMessage: "temporary network failure",
            }
            : {
              outcome: "flushed",
              latestEventId: 2,
              latestExternalEventSequence: 1,
              pendingEventCount: 0,
              consecutiveFailures: 0,
              disabled: false,
            };
        },
      }),
      immediateFlushEventCount: 1,
      getRetryDelayMs: () => 250,
    });
    const options = { abortSignal: new AbortController().signal, waitForRetries: true };
    const first = mirror.flush(options);
    const second = mirror.flush(options);
    try {
      await time.tickAsync(0);
      await mirror.flush();
      mirror.enqueue([{ type: "another capture" }]);
      await time.tickAsync(249);
      assertEquals(attempts, 1, "concurrent callers must retain the shared backoff");
      await time.tickAsync(1);
      assertEquals((await first).pendingEventCount, 0);
      assertEquals((await second).pendingEventCount, 0);
      assertEquals(attempts, 2);
    } finally {
      mirror.dispose();
    }
  });

  it("cancels a persistence drain during retry backoff without another append", async () => {
    using time = new FakeTime();
    let attempts = 0;
    const controller = createMockQueueController({
      pendingEvents: [{ type: "capture" }],
      flushImpl: async () => {
        attempts++;
        return {
          outcome: "retry_scheduled",
          latestEventId: 1,
          latestExternalEventSequence: 0,
          pendingEventCount: 1,
          consecutiveFailures: attempts,
          disabled: false,
          errorMessage: "temporary network failure",
        };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 2,
      getRetryDelayMs: () => 250,
    });
    const abort = new AbortController();
    const options = { abortSignal: abort.signal, waitForRetries: true };
    const rejected = assertRejects(() => mirror.flush(options), DOMException, "deadline");
    try {
      await time.tickAsync(0);
      abort.abort(new DOMException("persistence deadline", "AbortError"));
      await rejected;
      mirror.dispose();
      await time.tickAsync(1000);
      assertEquals(attempts, 1);
      assertEquals(mirror.getSnapshot().pendingEventCount, 1);
      assertEquals(mirror.getSnapshot().hasRetryTimer, false);
    } finally {
      mirror.dispose();
    }
  });

  it("observes caller cancellation while a shared retry append is in flight", async () => {
    using time = new FakeTime();
    const secondAppend = Promise.withResolvers<void>();
    let attempts = 0;
    const mirror = createConversationRunMirror({
      queueController: createMockQueueController({
        pendingEvents: [{ type: "capture" }],
        flushImpl: async () => {
          attempts++;
          if (attempts === 1) {
            return {
              outcome: "retry_scheduled",
              latestEventId: 1,
              latestExternalEventSequence: 0,
              pendingEventCount: 1,
              consecutiveFailures: 1,
              disabled: false,
              errorMessage: "temporary network failure",
            };
          }
          await secondAppend.promise;
          return {
            outcome: "flushed",
            latestEventId: 2,
            latestExternalEventSequence: 1,
            pendingEventCount: 0,
            consecutiveFailures: 0,
            disabled: false,
          };
        },
      }),
      immediateFlushEventCount: 2,
      getRetryDelayMs: () => 250,
    });
    const abort = new AbortController();
    let status = "pending";
    const draining = mirror.flush({ abortSignal: abort.signal, waitForRetries: true }).then(
      () => {
        status = "resolved";
      },
      (error) => {
        assertEquals(error, abort.signal.reason);
        status = "rejected";
      },
    );
    try {
      await time.tickAsync(250);
      assertEquals(attempts, 2);
      await time.tickAsync(0);
      abort.abort(new DOMException("persistence deadline", "AbortError"));
      await time.tickAsync(0);
      assertEquals(status, "rejected", "cancellation must not wait for another caller's append");
    } finally {
      secondAppend.resolve();
      await draining;
      mirror.dispose();
    }
  });

  it("requires an abort signal before waiting for persistence retries", async () => {
    const mirror = createConversationRunMirror({
      queueController: createMockQueueController(),
      immediateFlushEventCount: 2,
    });
    try {
      await assertRejects(
        () => mirror.flush({ waitForRetries: true }),
        TypeError,
        "requires an abort signal",
      );
    } finally {
      mirror.dispose();
    }
  });

  it("runs immediate, retry, and explicit queue flushes inside the owner hook", async () => {
    using time = new FakeTime();
    const calls: string[] = [];
    let flushCalls = 0;
    const controller = createMockQueueController({
      flushImpl: async () => {
        calls.push("controller");
        flushCalls += 1;
        if (flushCalls === 1) {
          return {
            outcome: "retry_scheduled" as const,
            latestEventId: 0,
            latestExternalEventSequence: 0,
            pendingEventCount: 1,
            consecutiveFailures: 1,
            disabled: false,
            errorMessage: "retry",
          };
        }
        return {
          outcome: "flushed" as const,
          latestEventId: flushCalls,
          latestExternalEventSequence: flushCalls,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
        };
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 1,
      getRetryDelayMs: () => 25,
      runQueueFlush: async (operation) => {
        calls.push("owner");
        return await operation();
      },
    });

    mirror.enqueue([{ id: "immediate" }]);
    await time.tickAsync(0);
    await time.tickAsync(25);
    mirror.enqueue([{ id: "explicit" }]);
    await mirror.flush();

    assertEquals(calls, [
      "owner",
      "controller",
      "owner",
      "controller",
      "owner",
      "controller",
    ]);
    mirror.dispose();
  });

  it("does not enter a delayed queue flush after its owner closes", async () => {
    using time = new FakeTime();
    let active = true;
    let ownerCalls = 0;
    let controllerCalls = 0;
    const controller = createMockQueueController({
      flushImpl: async () => {
        controllerCalls += 1;
        return {
          outcome: "flushed" as const,
          latestEventId: 1,
          latestExternalEventSequence: 1,
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
      runQueueFlush: async (operation) => {
        ownerCalls += 1;
        if (!active) throw new Error("owner closed");
        return await operation();
      },
    });

    mirror.enqueue([{ id: "delayed" }]);
    active = false;
    await time.tickAsync(50);

    assertEquals(ownerCalls, 1);
    assertEquals(controllerCalls, 0);
    mirror.dispose();
  });

  it("rejects an explicit flush when a controller failure escaped the queue", async () => {
    const controller = createMockQueueController({
      pendingEvents: [],
      flushImpl: () => {
        throw new Error("append exploded");
      },
    });
    const mirror = createConversationRunMirror({
      queueController: controller,
      immediateFlushEventCount: 1,
    });

    try {
      mirror.enqueue([{ id: 1 }]);

      await assertRejects(
        () => mirror.flush(),
        Error,
        "append exploded",
        "flush must surface a controller failure that escaped the queue instead of resolving",
      );

      const snapshot = mirror.getSnapshot();
      assertEquals(
        snapshot.pendingEventCount,
        1,
        "an escaped flush failure must leave the events queued",
      );
      assertEquals(
        snapshot.hasRetryTimer,
        true,
        "an escaped flush failure must schedule a retry",
      );
    } finally {
      mirror.dispose();
    }
  });

  it("rejects an explicit flush when the retry was caused by a timeout", async () => {
    using time = new FakeTime();
    const timedOutFlush: ConversationRunEventQueueController["flush"] = async () => ({
      outcome: "retry_scheduled" as const,
      latestEventId: 2,
      latestExternalEventSequence: 3,
      pendingEventCount: 1,
      consecutiveFailures: 1,
      disabled: false,
      errorMessage: "append timed out",
      retryCause: "timeout" as const,
    });

    const escalating = createConversationRunMirror({
      queueController: createMockQueueController({ flushImpl: timedOutFlush }),
      immediateFlushEventCount: 2,
      flushDelayMs: 1_000,
      getRetryDelayMs: () => 250,
    });

    try {
      escalating.enqueue([{ id: 1 }]);
      await assertRejects(
        () => escalating.flush({ throwOnTimeoutRetry: true }),
        Error,
        "timed out",
        "a timeout-caused retry must reject an explicit flush",
      );
    } finally {
      escalating.dispose();
    }

    const tolerant = createConversationRunMirror({
      queueController: createMockQueueController({ flushImpl: timedOutFlush }),
      immediateFlushEventCount: 2,
      flushDelayMs: 1_000,
      getRetryDelayMs: () => 250,
    });

    try {
      tolerant.enqueue([{ id: 1 }]);
      assertEquals(
        (await tolerant.flush()).pendingEventCount,
        1,
        "without the flag a timeout retry resolves normally",
      );
    } finally {
      tolerant.dispose();
    }

    await time.tickAsync(0);
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
