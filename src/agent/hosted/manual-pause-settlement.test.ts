import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "./manual-pause-credential.ts";
import { agentManualPauseBoundary } from "../runtime/manual-pause.ts";
import {
  canSettleHostedAgentPause,
  invalidateHostedAgentPauseSettlement,
  recordHostedAgentPauseCleanup,
  recordHostedAgentPauseFlush,
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
        { checkpoint, settlementRequired: true },
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
