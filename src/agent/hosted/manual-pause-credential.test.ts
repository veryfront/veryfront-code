import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

  it("cancels and retries server-error replies until an acknowledgement settles", async () => {
    const statuses: number[] = [];
    let cancelled = 0;
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: new AbortController().signal,
      fetch: () => {
        const status = statuses.length === 0 ? 503 : 200;
        statuses.push(status);
        if (status === 200) return Promise.resolve(Response.json({ stop: true }));
        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled++;
          },
        });
        return Promise.resolve(new Response(body, { status }));
      },
    });
    assertEquals(await authority.acknowledge(checkpoint), true);
    assertEquals(statuses, [503, 200]);
    assertEquals(cancelled, 1);
    assertEquals(hasHostedAgentPauseStopped(authority), true);
  });

  it("holds the boundary without retrying when the API rejects the pause request", async () => {
    let attempts = 0;
    let cancelled = 0;
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com//",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: new AbortController().signal,
      fetch: (url) => {
        assertEquals(String(url), "https://api.example.com/runs/run_pause_test/pause-ack");
        attempts++;
        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled++;
          },
        });
        return Promise.resolve(new Response(body, { status: 409 }));
      },
    });
    const error = await assertRejects(() => authority.acknowledge(checkpoint));
    assertEquals(isAgentManualPauseBoundary(error), true);
    assertEquals(attempts, 1);
    assertEquals(cancelled, 1);
    assertEquals(hasHostedAgentPauseStopped(authority), true);
  });

  it("stays stopped when the checkpoint load reports the run was stopped", async () => {
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: new AbortController().signal,
      fetch: () => Promise.resolve(Response.json({ stop: true, checkpoint: null })),
    });
    const error = await assertRejects(() => authority.load());
    assertEquals(isAgentManualPauseBoundary(error), true);
    assertEquals(hasHostedAgentPauseStopped(authority), true);
  });

  it("never contacts the API once the pause lifetime has ended", async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    let attempts = 0;
    const authority = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.com",
      runId: "run_pause_test",
      token: "pause-test-token",
      signal: lifetime.signal,
      fetch: () => {
        attempts++;
        return Promise.resolve(Response.json({ stop: false, checkpoint: null }));
      },
    });
    const error = await assertRejects(() => authority.load());
    assertEquals(isAgentManualPauseBoundary(error), true);
    assertEquals(attempts, 0);
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

it("checks pause intent without sending the continuation", async () => {
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: new AbortController().signal,
    fetch: (url, init) => {
      assertEquals(
        String(url),
        "https://api.example.com/runs/run_pause_test/pause-checkpoint?boundary=true",
      );
      assertEquals(init?.body, undefined);
      return Promise.resolve(
        Response.json({ stop: false, checkpoint: null, pauseRequested: false }),
      );
    },
  });
  assertEquals(await authority.requested?.(), false);
});

it("retains checkpoint writes after resuming a durable continuation", async () => {
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: new AbortController().signal,
    fetch: (url) =>
      Promise.resolve(
        Response.json(
          String(url).endsWith("?boundary=true")
            ? { stop: false, checkpoint: null, pauseRequested: false }
            : { stop: false, checkpoint },
        ),
      ),
  });
  assertEquals(await authority.load(), checkpoint);
  assertEquals(await authority.requested?.(), true);
});

it("keeps acknowledgement checkpoints for a control plane without boundary probes", async () => {
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: new AbortController().signal,
    fetch: () => Promise.resolve(Response.json({ stop: false, checkpoint: null })),
  });
  assertEquals(await authority.requested?.(), true);
});

it("holds execution through a pause API outage until a valid reply arrives", async () => {
  let attempts = 0;
  const carrier = {};
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: new AbortController().signal,
    fetch: () => {
      assertEquals(hasHostedAgentPauseStopped(carrier), true);
      attempts++;
      return Promise.resolve(
        attempts <= 3
          ? new Response(null, { status: 503 })
          : Response.json({ stop: false, checkpoint: null, pauseRequested: false }),
      );
    },
  });
  inheritHostedAgentPauseCapability(carrier, authority);
  assertEquals(await authority.requested?.(), false);
  assertEquals(attempts, 4);
  assertEquals(hasHostedAgentPauseStopped(carrier), false);
});

it("retires a resumed continuation only after the dispatch gate confirms no pause", async () => {
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: AbortSignal.timeout(3000),
    fetch: (url, init) => {
      if (init?.method === "POST") {
        assertEquals(JSON.parse(String(init.body)), { checkpoint: null });
        return Promise.resolve(Response.json({ stop: false }));
      }
      return Promise.resolve(
        Response.json(
          String(url).includes("?boundary=true")
            ? { stop: false, checkpoint: null, pauseRequested: false }
            : { stop: false, checkpoint },
        ),
      );
    },
  });
  await authority.load();
  assertEquals(await authority.requested?.(), true);
  assertEquals(await authority.release?.(), false);
  assertEquals(await authority.requested?.(), false);
});

it("loads a checkpoint at its byte budget with response envelope overhead", async () => {
  const nearLimit = { ...checkpoint, latestAssistantText: "" };
  nearLimit.latestAssistantText = "x".repeat(2 * 1024 * 1024 - JSON.stringify(nearLimit).length);
  const authority = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run_pause_test",
    token: "pause-test-token",
    signal: AbortSignal.timeout(3000),
    fetch: () => Promise.resolve(Response.json({ stop: false, checkpoint: nearLimit })),
  });
  const loaded = await authority.load() as typeof nearLimit;
  assertEquals(loaded.latestAssistantText.length, nearLimit.latestAssistantText.length);
});
