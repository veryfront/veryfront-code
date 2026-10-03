import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "./manual-pause-credential.ts";
import { isAgentManualPauseBoundary } from "../runtime/manual-pause.ts";
import { finalizeHostedResponse } from "./stream-finalization.ts";

describe("hosted manual pause finalization", () => {
  for (
    const [lostReply, flushFails] of [[false, false], [true, false], [false, true], [true, true]]
  ) {
    it(`flushes and cleans up without synthesizing a terminal outcome (lost=${lostReply}, flushFails=${flushFails})`, async () => {
      const controller = new AbortController();
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId: "run_pause_test",
        token: "pause-test-token",
        signal: controller.signal,
        fetch: () => {
          if (lostReply) {
            controller.abort();
            throw new TypeError("Reply lost after commit");
          }
          return Promise.resolve(Response.json({ stop: true }));
        },
      });
      try {
        await capability.acknowledge({
          version: 1,
          nextStep: 0,
          messages: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latestAssistantText: "",
          completed: false,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
        });
      } catch (error) {
        assertEquals(lostReply, true);
        assertEquals(isAgentManualPauseBoundary(error), true);
      }
      let terminals = 0;
      let flushes = 0;
      let cleanups = 0;
      const dispatchTerminalState = () => {
        terminals++;
      };
      inheritHostedAgentPauseCapability(dispatchTerminalState, capability);
      const unavailable = () => {
        throw new Error("A paused producer has no terminal step");
      };
      await finalizeHostedResponse({
        isAborted: false,
        getFinalStep: unavailable,
        buildState: unavailable,
        shouldFailEmptyMessage: () => false,
        resolveEmptyTerminalError: unavailable,
        appendFallbackChunk: unavailable,
        flushMirror: () => {
          flushes++;
          if (flushFails) throw new Error("Mirror storage unavailable");
        },
        dispatchTerminalState,
        resolveTerminalState: () => ({ status: "completed" }),
        cleanup: () => {
          cleanups++;
        },
      });
      assertEquals(terminals, 0);
      assertEquals(flushes, 1);
      assertEquals(cleanups, 1);
    });
  }
});
