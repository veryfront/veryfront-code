import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/protocol.ts";
import type {
  ConversationRunEventQueueController,
  ConversationRunEventQueueFlushResult,
  ConversationRunEventQueueSnapshot,
} from "../durable.ts";
import type { ConversationRunEvent } from "./run-events.ts";
import {
  createConversationRunChunkMirror,
  createHostedConversationRunChunkMirror,
  type HostedConversationRunChunkMirrorTraceAttributes,
} from "./run-chunk-mirror.ts";

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
      return { outcome: "flushed", latestEventId: 0, latestExternalEventSequence: 0 };
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
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello" },
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
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hello" },
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
});
