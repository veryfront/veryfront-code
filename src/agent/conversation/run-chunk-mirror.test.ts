import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/protocol.ts";
import type { ConversationRunEventQueueController } from "./durable.ts";
import type { ConversationRunEvent } from "./run-events.ts";
import {
  createConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorTraceAttributes,
} from "./run-chunk-mirror.ts";

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

describe("agent/conversation-run-chunk-mirror", () => {
  it("prepares UI chunks into durable events and enqueues them", async () => {
    const queueController = createQueueController();
    const preparedTypes: string[] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
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

  it("normalizes external events before enqueueing", async () => {
    const queueController = createQueueController();
    const prepared: ConversationRunEvent[][] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
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

  it("allows hosts to wrap chunk and external event preparation", async () => {
    const queueController = createQueueController();
    const preparedMarkers: string[] = [];
    const mirror = createConversationRunChunkMirror({
      queueController,
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
});
