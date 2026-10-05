import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "./manual-pause-credential.ts";
import { agentManualPauseBoundary } from "../runtime/manual-pause.ts";
import { createHostedConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import {
  canSettleHostedAgentPause,
  invalidateHostedAgentPauseSettlement,
  isHostedAgentPauseAcknowledged,
  recordHostedAgentPauseCleanup,
  recordHostedAgentPauseFlush,
  recordHostedAgentPauseMirrorSnapshot,
  settleHostedAgentPause,
} from "./manual-pause-settlement.ts";

const checkpoint = {
  version: 1 as const,
  nextStep: 0,
  messages: [],
  toolCalls: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  latestAssistantText: "",
  completed: false,
  recoveredEmptyResponse: false,
  recoveredInterruptedLocalToolBatch: false,
};

describe("hosted pause settlement transport", () => {
  for (const nativePersisted of [true, false]) {
    it(`drains real mirror batches with unchanged zero-append cursors (native persisted=${nativePersisted})`, async () => {
      let confirmations = 0;
      let batches = 0;
      const failures: unknown[] = [];
      const runId = "run_pause_mirror";
      const conversationId = "11111111-1111-4111-a111-111111111111";
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId,
        token: "pause-test-token",
        signal: new AbortController().signal,
        fetch: (_url, init) => {
          if (JSON.parse(String(init?.body)).settled) confirmations++;
          return Promise.resolve(Response.json({ stop: true }));
        },
      });
      const mirror = createHostedConversationRunChunkMirror({
        apiUrl: "https://api.example.com",
        authToken: "mirror-test-token",
        runId,
        canonicalRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conversationId,
        latestEventId: 9,
        latestExternalEventSequence: 5,
        batchSize: 64,
        instrumentation: {
          warn: (message, metadata) => failures.push({ message, metadata }),
          error: (message, metadata) => failures.push({ message, metadata }),
        },
        fetch: async (input, init) => {
          const body = await new Request(input, init).json();
          assertEquals(body.events.length, 1);
          batches++;
          return Response.json({
            latest_event_id: 9,
            latest_external_event_sequence: 5,
            appended_count: 0,
            run: {
              run_id: runId,
              conversation_id: conversationId,
              latest_event_id: 9,
              latest_external_event_sequence: 5,
            },
          });
        },
      });
      try {
        assertEquals(await capability.acknowledge(checkpoint), true);
        capability.persisted?.(nativePersisted);
        for (const delta of ["queued boundary output", "late output after ACK"]) {
          await mirror.handleChunk({ type: "text-delta", id: "boundary-message", delta });
          const snapshot = await mirror.flush();
          assertEquals(snapshot.latestEventId, 9);
          assertEquals(snapshot.latestExternalEventSequence, 5);
          assertEquals(snapshot.pendingEventCount, 0, JSON.stringify(failures));
          assertEquals(snapshot.disabled, false);
          assertEquals(snapshot.inFlight, false);
          assertEquals(snapshot.hasRetryTimer, false);
          recordHostedAgentPauseMirrorSnapshot(capability, snapshot);
        }
        assertEquals(batches, 2);
        await settleHostedAgentPause(capability);
        assertEquals(confirmations, 0);
        recordHostedAgentPauseCleanup(capability, true);
        assertEquals(canSettleHostedAgentPause(capability), nativePersisted);
        await settleHostedAgentPause(capability);
        assertEquals(confirmations, nativePersisted ? 1 : 0);
      } finally {
        mirror.dispose();
      }
    });
  }

  for (
    const replies of [
      ["confirmed"],
      ["rejected"],
      ["conflict"],
      ["server-error", "confirmed"],
      ["lost", "confirmed"],
      ["invalid", "confirmed"],
      ["malformed", "confirmed"],
      ["server-error", "server-error", "server-error", "server-error", "server-error"],
    ]
  ) {
    it(`keeps confirmation bounded and fenced for ${replies.join(", ")}`, async () => {
      const bodies: unknown[] = [];
      let confirmations = 0;
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId: "run_pause_test",
        token: "pause-test-token",
        signal: new AbortController().signal,
        fetch: (_url, init) => {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          if (!body.settled) return Promise.resolve(Response.json({ stop: true }));
          const reply = replies[confirmations++];
          if (reply === "lost") throw new TypeError("Lost confirmation reply");
          if (reply === "server-error") {
            return Promise.resolve(new Response("Unavailable", { status: 503 }));
          }
          if (reply === "conflict") {
            return Promise.resolve(new Response("Stale dispatch", { status: 409 }));
          }
          if (reply === "invalid") return Promise.resolve(Response.json({ unexpected: true }));
          if (reply === "malformed") return Promise.resolve(new Response("{"));
          return Promise.resolve(Response.json({ stop: reply === "confirmed" }));
        },
      });
      assertEquals(await capability.acknowledge(checkpoint), true);
      await settleHostedAgentPause(capability);
      assertEquals(confirmations, 0);
      recordHostedAgentPauseFlush(capability, true);
      await settleHostedAgentPause(capability);
      assertEquals(confirmations, 0);
      recordHostedAgentPauseCleanup(capability, true);
      assertEquals(canSettleHostedAgentPause(capability), false);
      capability.persisted?.(true);
      assertEquals(canSettleHostedAgentPause(capability), true);
      await settleHostedAgentPause(capability);
      assertEquals(confirmations, replies.length);
      assertEquals(bodies, [
        { checkpoint, settlement_required: true },
        ...replies.map(() => ({ settled: true })),
      ]);
    });
  }

  for (const failure of ["flush", "cleanup", "execution", "cancel"]) {
    it(`never confirms after ${failure} fails, including a later successful cleanup`, async () => {
      const controller = new AbortController();
      let requests = 0;
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId: "run_pause_test",
        token: "pause-test-token",
        signal: controller.signal,
        fetch: () => {
          requests++;
          return Promise.resolve(Response.json({ stop: true }));
        },
      });
      await capability.acknowledge(checkpoint);
      capability.persisted?.(true);
      const carrier = () => {};
      inheritHostedAgentPauseCapability(carrier, capability);
      invalidateHostedAgentPauseSettlement(carrier, agentManualPauseBoundary());
      recordHostedAgentPauseFlush(carrier, failure !== "flush");
      recordHostedAgentPauseCleanup(carrier, failure !== "cleanup");
      if (failure === "execution") {
        invalidateHostedAgentPauseSettlement(carrier, new Error("Stream failed"));
      }
      if (failure === "cancel") controller.abort();
      recordHostedAgentPauseFlush(carrier, true);
      recordHostedAgentPauseCleanup(carrier, true);
      assertEquals(canSettleHostedAgentPause(carrier), false);
      await settleHostedAgentPause(carrier);
      assertEquals(requests, 1);
    });
  }

  it("interrupts unknown active ACK replies on session failure while settlement lifetime stays live", async () => {
    const session = new AbortController();
    const execution = new AbortController();
    const capability = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: session.signal,
      settlementSignal: execution.signal,
      fetch: () => {
        session.abort();
        throw new TypeError("Lost ACK reply");
      },
    });
    await assertRejects(() => capability.acknowledge(checkpoint));
    assertEquals(execution.signal.aborted, false);
    assertEquals(canSettleHostedAgentPause(capability), false);
  });

  it("preserves acknowledged pauses after the settlement lifetime aborts", async () => {
    const execution = new AbortController();
    const settlement = new AbortController();
    let requests = 0;
    const capability = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: execution.signal,
      settlementSignal: settlement.signal,
      fetch: () => {
        requests++;
        return Promise.resolve(Response.json({ stop: true }));
      },
    });
    assertEquals(isHostedAgentPauseAcknowledged(capability), false);
    assertEquals(await capability.acknowledge(checkpoint), true);
    capability.persisted?.(true);
    recordHostedAgentPauseFlush(capability, true);
    recordHostedAgentPauseCleanup(capability, true);
    const carrier = {};
    inheritHostedAgentPauseCapability(carrier, capability);
    assertEquals(canSettleHostedAgentPause(carrier), true);
    settlement.abort();
    assertEquals(isHostedAgentPauseAcknowledged(carrier), true);
    assertEquals(canSettleHostedAgentPause(carrier), false);
    await settleHostedAgentPause(carrier);
    assertEquals(requests, 1);
  });

  it("ignores unregistered carriers and rejects invalid carriers", async () => {
    const carrier = {};
    recordHostedAgentPauseFlush(carrier, true);
    recordHostedAgentPauseCleanup(carrier, true);
    invalidateHostedAgentPauseSettlement(carrier, new Error("Unrelated"));
    assertEquals(canSettleHostedAgentPause(carrier), false);
    await settleHostedAgentPause(carrier);
    assertThrows(() => canSettleHostedAgentPause(null), TypeError);
    await assertRejects(() => settleHostedAgentPause("invalid"), TypeError);
  });
});
