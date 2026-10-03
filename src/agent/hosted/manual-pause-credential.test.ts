import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  activateHostedAgentPauseCapability,
  createRunBoundAgentManualPause,
  hasHostedAgentPauseStopped,
  inheritHostedAgentPauseCapability,
  registerHostedAgentPauseFactory,
} from "./manual-pause-credential.ts";
import { isAgentManualPauseBoundary } from "../runtime/manual-pause.ts";

const checkpoint = {
  version: 1 as const,
  nextStep: 1,
  messages: [],
  toolCalls: [],
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  latestAssistantText: "",
  completed: false,
  recoveredEmptyResponse: false,
  recoveredInterruptedLocalToolBatch: false,
};

describe("hosted agent pause capability", () => {
  it("replays identical checkpoint bytes after a lost acknowledgement", async () => {
    const bodies: string[] = [];
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: new AbortController().signal,
      fetch: async (url, init) => {
        assertEquals(String(url), "https://api.example.com/runs/run_pause_test/pause-ack");
        assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer pause-test-token");
        assertEquals(init?.redirect, "error");
        bodies.push(String(init?.body));
        if (bodies.length === 1) throw new TypeError("Reply was lost after commit");
        return Response.json({ stop: true });
      },
    });
    assertEquals(await authority.acknowledge(checkpoint), true);
    assertEquals(bodies.length, 2);
    assertEquals(bodies[0], bodies[1]);
    assertEquals(JSON.parse(bodies[0]!), { checkpoint });
    assertEquals(JSON.stringify(authority).includes("pause-test-token"), false);
  });

  it("holds the boundary through malformed replies and loads the private continuation", async () => {
    let attempts = 0;
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: new AbortController().signal,
      fetch: (url, init) => {
        if (init?.method === "GET") {
          assertEquals(String(url), "https://api.example.com/runs/run_pause_test/pause-checkpoint");
          return Promise.resolve(Response.json({ stop: false, checkpoint }));
        }
        attempts++;
        return Promise.resolve(Response.json(attempts === 1 ? {} : { stop: false }));
      },
    });
    assertEquals(await authority.load(), checkpoint);
    assertEquals(await authority.acknowledge(checkpoint), false);
    assertEquals(attempts, 2);
  });
});

for (const abortLifetime of ["execution", "session"] as const) {
  it(`keeps a lazy inherited pause capability held when ${abortLifetime} ends`, async () => {
    const execution = new AbortController();
    const session = new AbortController();
    const ingress = {};
    const prepared = {};
    const clonedStart = {};
    const runtime = {};
    let constructions = 0;
    registerHostedAgentPauseFactory(ingress, (signal) => {
      constructions++;
      return createRunBoundAgentManualPause({
        apiUrl: "https://api.example.com",
        runId: "run_pause_test",
        token: "pause-test-token",
        signal,
        fetch: () => {
          (abortLifetime === "execution" ? execution : session).abort();
          throw new TypeError("Acknowledgement reply lost after commit");
        },
      });
    });
    inheritHostedAgentPauseCapability(prepared, ingress, execution.signal);
    inheritHostedAgentPauseCapability(clonedStart, prepared);
    assertEquals(constructions, 0);
    const capability = activateHostedAgentPauseCapability(clonedStart, session.signal)!;
    inheritHostedAgentPauseCapability(runtime, clonedStart);
    assertEquals(constructions, 1);
    let boundary: unknown;
    try {
      await capability.acknowledge(checkpoint);
    } catch (error) {
      boundary = error;
    }
    assertEquals(isAgentManualPauseBoundary(boundary), true);
    assertEquals(hasHostedAgentPauseStopped(runtime), true);
    assertEquals(JSON.stringify(runtime), "{}");
    assertEquals(activateHostedAgentPauseCapability(clonedStart, session.signal), capability);
    assertEquals(constructions, 1);
  });
}
