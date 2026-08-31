import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/protocol.ts";
import type { ConversationRunEventQueueController } from "./durable.ts";
import { type ConversationRunEvent, ConversationRunEventEncoder } from "./run-events.ts";
import {
  createConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorTraceAttributes,
} from "./run-chunk-mirror.ts";
import { createDurableRunEventSink } from "../hosted/durable-run-event-sink.ts";

type ConversationRunEventQueueFlushResult = Awaited<
  ReturnType<ConversationRunEventQueueController["flush"]>
>;
type ConversationRunEventQueueSnapshot = ReturnType<
  ConversationRunEventQueueController["getSnapshot"]
>;

function createQueueController(): ConversationRunEventQueueController & {
  enqueued: unknown[];
  disabled: boolean;
} {
  const enqueued: unknown[] = [];
  return {
    enqueued,
    disabled: false,
    enqueue(events: unknown[]) {
      enqueued.push(...events);
    },
    async flush(): Promise<ConversationRunEventQueueFlushResult> {
      enqueued.length = 0;
      return {
        outcome: "flushed",
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount: 0,
        consecutiveFailures: 0,
        disabled: this.disabled,
      };
    },
    getSnapshot(): ConversationRunEventQueueSnapshot {
      return {
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount: enqueued.length,
        consecutiveFailures: 0,
        disabled: this.disabled,
      };
    },
  };
}

const RETRY_LOG_MESSAGE = "Durable run mirror flush failed; queued for retry";

describe("agent/conversation-run-chunk-mirror", () => {
  it("prepares UI chunks into durable events and enqueues them", async () => {
    const queueController = createQueueController();
    const preparedTypes: string[] = [];
    const legacyEncoder = new ConversationRunEventEncoder();
    Object.defineProperty(legacyEncoder, "getTimingAnchor", { value: undefined });
    const mirror = createConversationRunChunkMirror({
      queueController,
      // Encoders created before timing-anchor introspection remain accepted.
      encoder: legacyEncoder,
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      onChunkPrepared: ({ events }) => {
        preparedTypes.push(...events.map((event) => event.type));
      },
    });

    await mirror.handleChunk({ type: "text-delta", id: "m1", delta: "hello" });

    assertEquals(preparedTypes, ["TEXT_MESSAGE_CONTENT"]);
    assertEquals(queueController.enqueued, [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", contentId: "text:0", delta: "hello" },
    ]);
    mirror.dispose();
  });

  // The other mirror tests pin an unclocked encoder so their exact-event
  // assertions stay deterministic, which leaves the default unproven. This
  // covers it: omitting `encoder` must yield durable events that carry producer timing.
  it("installs a clock on the encoder it creates by default", async () => {
    const queueController = createQueueController();
    const prepared: ConversationRunEvent[] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      onChunkPrepared: ({ events }) => {
        prepared.push(...events);
      },
    });

    await mirror.handleChunk({ type: "text-delta", id: "m1", delta: "hello" });

    const elapsedMs = prepared[0]?.elapsedMs;
    assertEquals(typeof elapsedMs, "number", "the default encoder must stamp elapsedMs");
    assertEquals(
      typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0,
      true,
      `elapsed must be a finite, nonnegative reading, got ${String(elapsedMs)}`,
    );
    const emittedAt = prepared[0]?.emittedAt;
    assertEquals(
      typeof emittedAt === "number" && Number.isInteger(emittedAt) && emittedAt > 0,
      true,
      `emittedAt must be a positive epoch timestamp, got ${String(emittedAt)}`,
    );
    mirror.dispose();
  });

  it("shares a custom encoder anchor with the private durable event sink", async () => {
    const queueController = createQueueController();
    let now = 100;
    let epoch = 1_000;
    const encoder = new ConversationRunEventEncoder({
      nowMs: () => now,
      epochMs: () => epoch,
    });
    const publicEvents: ConversationRunEvent[] = [];
    const privateEvents: ConversationRunEvent[] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
      encoder,
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      onChunkPrepared: ({ events }) => {
        publicEvents.push(...events);
      },
      onExternalEventsPrepared: ({ events }) => {
        privateEvents.push(...events);
      },
    });
    now = 142;
    epoch = 1_042;

    await mirror.handleChunk({ type: "text-delta", id: "m1", delta: "hello" });
    await createDurableRunEventSink({ mirror })({
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [],
    });

    assertEquals(
      publicEvents.map(({ elapsedMs, emittedAt }) => ({ elapsedMs, emittedAt })),
      [{ elapsedMs: 42, emittedAt: 1_042 }],
    );
    assertEquals(
      privateEvents.map(({ elapsedMs, emittedAt }) => ({ elapsedMs, emittedAt })),
      [{ elapsedMs: 42, emittedAt: 1_042 }],
    );
    mirror.dispose();
  });

  it("normalizes external events before enqueueing", async () => {
    const queueController = createQueueController();
    const prepared: ConversationRunEvent[][] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
      encoder: new ConversationRunEventEncoder(),
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      onExternalEventsPrepared: ({ events }) => {
        prepared.push(events);
      },
    });

    await mirror.appendEvents([
      { type: "TEXT_MESSAGE_CONTENT", delta: "" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "persisted" },
    ]);

    assertEquals(prepared, [[
      { type: "TEXT_MESSAGE_CONTENT", delta: "" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "persisted" },
    ]]);
    assertEquals(queueController.enqueued, [
      { type: "TEXT_MESSAGE_CONTENT", delta: "" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "persisted" },
    ]);
    mirror.dispose();
  });

  it("stamps missing external checkpoint timing and preserves supplied timing", async () => {
    const queueController = createQueueController();
    let now = 100;
    const encoder = new ConversationRunEventEncoder({
      nowMs: () => now,
      epochMs: () => 1_786_866_357_364,
    });
    const mirror = createConversationRunChunkMirror({
      queueController,
      encoder,
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
    });
    now = 142;

    await mirror.appendEvents([
      { type: "CONTEXT_COMPACTION", compactedMessageCount: 2 } as never,
      { type: "TOOL_EXPOSURE_CHECKPOINT", elapsedMs: 7, emittedAt: 8 } as never,
    ]);

    assertEquals(
      queueController.enqueued.map((event) => {
        const timed = event as { elapsedMs?: number; emittedAt?: number };
        return { elapsedMs: timed.elapsedMs, emittedAt: timed.emittedAt };
      }),
      [
        { elapsedMs: 42, emittedAt: 1_786_866_357_364 },
        { elapsedMs: 7, emittedAt: 8 },
      ],
    );
    mirror.dispose();
  });

  it("preserves timing across custom external event preparation", async () => {
    const queueController = createQueueController();
    let now = 100;
    let epoch = 1_000;
    const callbackInputTiming: Array<{ elapsedMs?: number; emittedAt?: number }> = [];
    const encoder = new ConversationRunEventEncoder({
      nowMs: () => now,
      epochMs: () => epoch,
    });
    const mirror = createConversationRunChunkMirror({
      queueController,
      encoder,
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      prepareExternalEvents: ({ events }) => {
        callbackInputTiming.push(...events.map((event) => {
          const timed = event as { elapsedMs?: number; emittedAt?: number };
          return { elapsedMs: timed.elapsedMs, emittedAt: timed.emittedAt };
        }));
        now = 160;
        epoch = 2_000;
        return [
          ...events,
          { type: "CONTEXT_COMPACTION", compactedMessageCount: 1 } as never,
        ];
      },
    });
    now = 142;
    epoch = 1_042;

    await mirror.appendEvents([
      { type: "TOOL_EXPOSURE_CHECKPOINT" } as never,
    ]);

    assertEquals(callbackInputTiming, [{ elapsedMs: 42, emittedAt: 1_042 }]);
    assertEquals(
      queueController.enqueued.map((event) => {
        const timed = event as { elapsedMs?: number; emittedAt?: number };
        return { elapsedMs: timed.elapsedMs, emittedAt: timed.emittedAt };
      }),
      [
        { elapsedMs: 42, emittedAt: 1_042 },
        { elapsedMs: 60, emittedAt: 2_000 },
      ],
    );
    mirror.dispose();
  });

  it("allows hosts to wrap chunk and external event preparation", async () => {
    const queueController = createQueueController();
    const preparedMarkers: string[] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
      encoder: new ConversationRunEventEncoder(),
      immediateFlushEventCount: 99,
      flushDelayMs: 10_000,
      prepareChunkEvents: ({ defaultPrepare }) => {
        preparedMarkers.push("chunk:start");
        const events = defaultPrepare();
        preparedMarkers.push(`chunk:${events.length}`);
        return events;
      },
      prepareExternalEvents: async ({ defaultPrepare }) => {
        preparedMarkers.push("external:start");
        const events = defaultPrepare();
        preparedMarkers.push(`external:${events.length}`);
        return events;
      },
    });

    await mirror.handleChunk({ type: "text-delta", id: "m1", delta: "hello" });
    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);

    assertEquals(preparedMarkers, ["chunk:start", "chunk:1", "external:start", "external:1"]);
    assertEquals(queueController.enqueued, [
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", contentId: "text:0", delta: "hello" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "persisted" },
    ]);
    mirror.dispose();
  });

  it("does not enqueue when the underlying mirror is disabled", async () => {
    const queueController = createQueueController();
    queueController.disabled = true;
    const mirror = createConversationRunChunkMirror({ queueController });

    const chunk: ChatUiMessageChunk = { type: "text-delta", id: "m1", delta: "ignored" };
    await mirror.handleChunk(chunk);
    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "ignored" }]);

    assertEquals(queueController.enqueued, []);
  });

  it("creates an API-backed hosted mirror with standard trace and debug instrumentation", async () => {
    const traceOperations: string[] = [];
    const traceAttributes: HostedConversationRunChunkMirrorTraceAttributes[] = [];
    const debugMessages: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    const mirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "conversation-1",
      runId: "run-1",
      latestEventId: 10,
      latestExternalEventSequence: 20,
      instrumentation: {
        trace: async (operationName, operation) => {
          traceOperations.push(operationName);
          return await operation();
        },
        setTraceAttributes: (attributes) => {
          traceAttributes.push(attributes);
        },
        debug: (message, metadata) => {
          debugMessages.push({ message, metadata });
        },
      },
    });

    await mirror.handleChunk({ type: "text-delta", id: "m1", delta: "hello" });
    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    mirror.dispose();

    assertEquals(traceOperations, ["durable.mirrorChunk", "durable.mirrorAppendEvents"]);
    assertEquals(traceAttributes, [
      {
        "conversation.id": "conversation-1",
        "run.id": "run-1",
        "stream.ui_chunk.type": "text-delta",
        "durable.event_count": 1,
      },
      {
        "conversation.id": "conversation-1",
        "run.id": "run-1",
        "durable.event_count": 1,
      },
    ]);
    assertEquals(debugMessages, [
      {
        message: "Durable run mirror processed UI chunk",
        metadata: {
          conversationId: "conversation-1",
          runId: "run-1",
          chunkType: "text-delta",
          durableEventTypes: ["TEXT_MESSAGE_CONTENT"],
          durableEventCount: 1,
        },
      },
      {
        message: "Durable run mirror queued external events",
        metadata: {
          conversationId: "conversation-1",
          runId: "run-1",
          durableEventTypes: ["TEXT_MESSAGE_CONTENT"],
          durableEventCount: 1,
        },
      },
    ]);
  });

  it("warns when a hosted mirror starts a high-backlog flush", async () => {
    const originalFetch = globalThis.fetch;
    const warnings: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    try {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              latestEventId: 3,
              latestExternalEventSequence: 3,
              appendedCount: 3,
              run: {
                runId: "run-1",
                conversationId: "11111111-1111-4111-8111-111111111111",
                latestEventId: 3,
                latestExternalEventSequence: 3,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )) as typeof fetch;
      const mirror = createHostedConversationRunChunkMirror({
        authToken: "token",
        apiUrl: "https://api.example.test",
        conversationId: "11111111-1111-4111-8111-111111111111",
        runId: "run-1",
        latestEventId: 0,
        batchSize: 3,
        highBacklogEventCount: 2,
        instrumentation: {
          warn: (message, metadata) => {
            warnings.push({ message, metadata });
          },
        },
      });

      await mirror.appendEvents([
        { type: "TEXT_MESSAGE_CONTENT", delta: "a" },
        { type: "TEXT_MESSAGE_CONTENT", delta: "b" },
        { type: "TEXT_MESSAGE_CONTENT", delta: "c" },
      ]);
      await mirror.flush();

      assertEquals(warnings, [{
        message: "Durable run mirror backlog is high",
        metadata: {
          conversationId: "11111111-1111-4111-8111-111111111111",
          runId: "run-1",
          pendingEventCount: 3,
          consecutiveFailures: 0,
          threshold: 2,
        },
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // VERYFRONT-AGENT-3: every retry_scheduled flush logged at error level, so a
  // degraded append endpoint emitted a Sentry error per ~5s retry per run. The
  // per-attempt log must stay at warn and escalate to error only once the
  // failure streak signals the condition is not self-healing.
  it("warns on early retry attempts and escalates to error at the failure threshold", async () => {
    const logs: Array<{ level: "warn" | "error"; message: string; consecutiveFailures: unknown }> =
      [];
    const failingFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ detail: "upstream unavailable" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch;
    const mirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      latestEventId: 0,
      fetch: failingFetch,
      instrumentation: {
        warn: (message, metadata) => {
          logs.push({ level: "warn", message, consecutiveFailures: metadata.consecutiveFailures });
        },
        error: (message, metadata) => {
          logs.push({ level: "error", message, consecutiveFailures: metadata.consecutiveFailures });
        },
      },
    });

    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await mirror.flush();
    }
    mirror.dispose();

    assertEquals(logs, [
      { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 1 },
      { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 2 },
      { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 3 },
      { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 4 },
      { level: "error", message: RETRY_LOG_MESSAGE, consecutiveFailures: 5 },
    ]);
  });

  it("records a terminal auth rejection instead of retrying forever", async () => {
    const originalFetch = globalThis.fetch;
    const errors: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    try {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ detail: "Invalid authentication token" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        )) as typeof fetch;
      const mirror = createHostedConversationRunChunkMirror({
        authToken: "expired-token",
        apiUrl: "https://api.example.test",
        conversationId: "11111111-1111-4111-8111-111111111111",
        runId: "run-1",
        latestEventId: 10,
        latestExternalEventSequence: 20,
        instrumentation: {
          error: (message, metadata) => {
            errors.push({ message, metadata });
          },
        },
      });

      await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
      const snapshot = await mirror.flush();
      mirror.dispose();

      assertEquals(snapshot.disabled, true);
      assertEquals(snapshot.pendingEventCount, 0);
      assertEquals(snapshot.hasRetryTimer, false);
      assertEquals(errors, [{
        message: "Disabling durable run mirroring after permanent append authentication rejection",
        metadata: {
          conversationId: "11111111-1111-4111-8111-111111111111",
          runId: "run-1",
          latestEventId: 10,
          latestExternalEventSequence: 20,
        },
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  // veryfront-issue-inbox#743: deleting a project cancels its in-flight runs, so
  // the next append is rejected with `Cannot append external events to a terminal
  // run`. That is a clean stop: warn once, record the reason finalization keys on,
  // and never log at error level.
  it("stops cleanly with a run_terminal reason when the run is already terminal", async () => {
    const logs: Array<{ level: "warn" | "error"; message: string }> = [];
    const terminalRunFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ detail: "Cannot append external events to a terminal run" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch;
    const mirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      latestEventId: 0,
      fetch: terminalRunFetch,
      instrumentation: {
        warn: (message) => {
          logs.push({ level: "warn", message });
        },
        error: (message) => {
          logs.push({ level: "error", message });
        },
      },
    });

    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    const snapshot = await mirror.flush();
    mirror.dispose();

    assertEquals(snapshot.disabled, true);
    assertEquals(snapshot.disableReason, "run_terminal");
    assertEquals(snapshot.pendingEventCount, 0);
    assertEquals(snapshot.hasRetryTimer, false);
    assertEquals(logs, [{
      level: "warn",
      message: "Stopping durable run mirroring because the run is already terminal",
    }]);
  });

  it("records an oversized-event stop instead of disabling mirroring silently", async () => {
    const errors: Array<{ message: string; metadata: Record<string, unknown> }> = [];
    const oversizedEventFetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ detail: "Agent run event payload must be less than 256 KB" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch;
    const mirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      latestEventId: 10,
      latestExternalEventSequence: 20,
      fetch: oversizedEventFetch,
      instrumentation: {
        error: (message, metadata) => {
          errors.push({ message, metadata });
        },
      },
    });

    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    const snapshot = await mirror.flush();
    mirror.dispose();

    assertEquals(snapshot.disabled, true, "an oversized event permanently stops mirroring");
    assertEquals(
      snapshot.disableReason,
      "payload_too_large",
      "an oversized event must record the payload_too_large stop reason",
    );
    assertEquals(snapshot.pendingEventCount, 0, "the rejected event is dropped, not retried");
    assertEquals(snapshot.hasRetryTimer, false, "a permanent rejection schedules no retry");
    assertEquals(
      errors,
      [{
        message: "Disabling durable run mirroring after an oversized event was rejected; " +
          "an event exceeded the durable payload limit despite normalization",
        metadata: {
          conversationId: "11111111-1111-4111-8111-111111111111",
          runId: "run-1",
          latestEventId: 10,
          latestExternalEventSequence: 20,
        },
      }],
      "an oversized-event stop must be reported at error level with the cursor metadata",
    );
  });

  // VERYFRONT-AGENT-3 (veryfront-issue-inbox#821): the threshold added for the
  // first incident stopped the first four retries from paging, but every
  // attempt at or past the threshold still logged at error level. Retry
  // backoff caps at ~5s, so one persistent append outage resumes emitting a
  // Sentry error every ~5s per active run once the streak reaches five.
  // Escalation must fire once per failure streak; the remaining attempts in
  // the same streak stay at warn. A successful flush ends the streak, so the
  // next persistent outage must escalate again.
  it("escalates a persistent retry streak to error once, not on every attempt", async () => {
    const logs: Array<{ level: "warn" | "error"; message: string; consecutiveFailures: unknown }> =
      [];
    let failing = true;
    const flakyFetch = (() =>
      Promise.resolve(
        failing
          ? new Response(
            JSON.stringify({ detail: "upstream unavailable" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          )
          : new Response(
            JSON.stringify({
              latestEventId: 1,
              latestExternalEventSequence: 1,
              appendedCount: 1,
              run: {
                runId: "run-1",
                conversationId: "11111111-1111-4111-8111-111111111111",
                latestEventId: 1,
                latestExternalEventSequence: 1,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      )) as typeof fetch;
    const mirror = createHostedConversationRunChunkMirror({
      authToken: "token",
      apiUrl: "https://api.example.test",
      conversationId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      latestEventId: 0,
      fetch: flakyFetch,
      instrumentation: {
        warn: (message, metadata) => {
          logs.push({ level: "warn", message, consecutiveFailures: metadata.consecutiveFailures });
        },
        error: (message, metadata) => {
          logs.push({ level: "error", message, consecutiveFailures: metadata.consecutiveFailures });
        },
      },
    });

    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await mirror.flush();
    }

    failing = false;
    await mirror.flush();

    failing = true;
    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "queued again" }]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await mirror.flush();
    }
    mirror.dispose();

    assertEquals(
      logs,
      [
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 1 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 2 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 3 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 4 },
        { level: "error", message: RETRY_LOG_MESSAGE, consecutiveFailures: 5 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 6 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 7 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 8 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 1 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 2 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 3 },
        { level: "warn", message: RETRY_LOG_MESSAGE, consecutiveFailures: 4 },
        { level: "error", message: RETRY_LOG_MESSAGE, consecutiveFailures: 5 },
      ],
      "a failure streak must escalate to error exactly once at the threshold; " +
        "later attempts in the same streak stay at warn, and a recovered flush " +
        "resets the streak so the next persistent outage escalates again",
    );
  });
});
