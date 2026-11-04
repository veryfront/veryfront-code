import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import {
  getVerifiedSkillScriptExecutionCredential,
  retainVerifiedSkillScriptExecutionCredentialUntil,
  runWithVerifiedSkillScriptExecutionCredential,
} from "#veryfront/skill/execution-credential.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
it("keeps connected credential live for an eager stream producer", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failure: unknown;
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "stream-credential-regression",
    system: "test",
    resolveModelTransport: () =>
      Promise.resolve({
        model: {
          provider: "test",
          modelId: "test/regression",
          executionMode: "remote",
          doGenerate() {
            throw new Error("unused");
          },
          doStream() {
            return Promise.resolve({
              stream: new ReadableStream({
                async start(controller) {
                  await released;
                  try {
                    assertEquals(
                      getVerifiedSkillScriptExecutionCredential()?.authToken,
                      "synthetic",
                    );
                  } catch (error) {
                    failure = error;
                  }
                  controller.enqueue({ type: "text-delta", delta: "done" });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "stop",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  });
                  controller.close();
                },
              }),
            });
          },
        },
      }),
  }, { onStreamCompletion: retainVerifiedSkillScriptExecutionCredentialUntil });
  const result = await runWithVerifiedSkillScriptExecutionCredential({
    assertActive() {},
    read() {
      return {
        apiUrl: "https://api.test",
        authToken: "synthetic",
        projectId: "test",
        runId: "test",
        agentId: "test",
      };
    },
  }, async () => await assistant.stream({ input: "test" }));
  release();
  await result.toDataStreamResponse().text();
  assertEquals(failure, undefined);
});
