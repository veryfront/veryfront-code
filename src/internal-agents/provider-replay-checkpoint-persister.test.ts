import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { createRunScopedProviderReplayCheckpointPersister } from "./provider-replay-checkpoint-persister.ts";

const checkpoint: ProviderReplayCheckpoint = {
  version: 1,
  messageId: "assistant-message-1",
  provider: "anthropic",
  providerBlocks: [{
    type: "provider-block",
    provider: "anthropic",
    block: { type: "thinking", thinking: "", signature: "PRIVATE_SIGNATURE" },
  }],
  providerBlockPositions: [0],
  providerMessageBlockCounts: [1],
  totalPartCount: 1,
};

describe("run-scoped provider replay checkpoint persistence", () => {
  it("awaits the exact-run API append response", async () => {
    let request: Request | undefined;
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: "run_1",
      runEventToken: "writer-token",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ appended_count: 1 });
      },
    });

    await persist(checkpoint);

    assertEquals(request?.url, "https://api.example.test/runs/run_1/events");
    assertEquals(request?.headers.get("Authorization"), "Bearer writer-token");
    assertEquals((await request?.json()).events, [{
      type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT",
      ...checkpoint,
    }]);
  });

  it("redacts private response failures", async () => {
    const persist = createRunScopedProviderReplayCheckpointPersister({
      apiUrl: "https://api.example.test",
      runId: "run_1",
      runEventToken: "writer-token",
      fetch: () => Promise.resolve(new Response("PRIVATE_SIGNATURE", { status: 409 })),
    });

    const error = await assertRejects(() => persist(checkpoint), Error, "HTTP 409");
    assertEquals(String(error).includes("PRIVATE_SIGNATURE"), false);
  });
});
