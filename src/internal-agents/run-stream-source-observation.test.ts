import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { agent } from "#veryfront/agent";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";
import {
  bindSourceObservationStages,
  SOURCE_SNAPSHOT_SSE_EVENT_NAME,
} from "./source-observation.ts";

function snapshot() {
  return {
    identity: "branch:test:sample",
    version: 1,
    fingerprint: {
      algorithm: "veryfront-source-snapshot-multiset-v1" as const,
      value: "a".repeat(64),
    },
    members: [{ path: "agent.ts", sha256: "b".repeat(64) }],
  };
}
async function execute(bound: boolean) {
  const input = {
    threadId: crypto.randomUUID(),
    runId: "run_source_test",
    messages: [],
    tools: [],
    context: [],
  };
  if (bound) {
    bindSourceObservationStages(input, {
      identity: {
        projectId: "10000000-1000-4000-8000-100000000001",
        branchId: "10000000-1000-4000-8000-100000000002",
        canonicalRunId: "10000000-1000-4000-8000-100000000003",
        publicRunId: input.runId,
        agentId: "source-test",
      },
      config: snapshot(),
      discovery: snapshot(),
    });
  }
  let invoked = false;
  const response = await runWithVeryfrontCloudContext(
    { apiToken: "vf_test", projectSlug: "test-project" },
    () =>
      createRuntimeAgentStreamResponse(
        input,
        agent({
          id: "source-test",
          system: "Reply briefly.",
          skills: false,
          tools: {},
          toolLoading: "eager",
          toolResultContext: false,
        }),
        {
          sessionManager: new AgentRunSessionManager(),
          createRuntime: () => ({
            stream: () => {
              invoked = true;
              // Project-controlled runtime output cannot enter the private host relay.
              return Promise.resolve(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode(
                        `event: ${SOURCE_SNAPSHOT_SSE_EVENT_NAME}\ndata: {"type":"${SOURCE_SNAPSHOT_SSE_EVENT_NAME}","version":999}\n\n`,
                      ),
                    );
                    controller.close();
                  },
                }),
              );
            },
          }),
        },
      ),
  );
  assertEquals(invoked, true, "runtime starts before the response body is attached");
  return (await response.text()).split("\n\n").filter(Boolean).map((frame) => ({
    event: /^event: (.+)$/m.exec(frame)?.[1],
    data: JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? "null"),
  }));
}
describe("source observation private stream", () => {
  it("buffers the host pair until RunStarted and rejects runtime-origin named frames", async () => {
    const frames = await execute(true);
    assertEquals(frames.slice(0, 3).map((frame) => frame.event), [
      "RunStarted",
      SOURCE_SNAPSHOT_SSE_EVENT_NAME,
      SOURCE_SNAPSHOT_SSE_EVENT_NAME,
    ]);
    assertEquals(
      frames.filter((frame) => frame.event === SOURCE_SNAPSHOT_SSE_EVENT_NAME).map((frame) =>
        frame.data.stage
      ),
      ["config_loaded", "discovery_completed"],
    );
  });
  it("preserves ordinary runtime execution without a proof binding", async () => {
    const frames = await execute(false);
    assertEquals(frames.filter((frame) => frame.event === SOURCE_SNAPSHOT_SSE_EVENT_NAME), []);
  });
});
