import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

describe("run-scoped inference credential", () => {
  afterEach(() => {
    restoreMockFetch();
    clearModelProviders();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
  });

  it("routes the dedicated credential from a runtime invocation to gateway Authorization", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-project-runtime-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
    let capturedAuthorization: string | null = null;
    const encoder = new TextEncoder();
    installMockFetch(
      (async (input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        capturedAuthorization = request.headers.get("Authorization");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof fetch,
    );
    const runtimeAgent = createAgent({
      id: "run-scoped-inference-agent",
      model: "veryfront-cloud/openai/gpt-test",
      system: "Answer concisely.",
      skills: false,
    });

    const response = await createRuntimeAgentStreamResponse(
      {
        agentId: runtimeAgent.id,
        threadId: crypto.randomUUID(),
        runId: "run_scoped_inference_1",
        messages: [{ id: "user-1", role: "user", content: "Hello" }],
        tools: [],
        context: [],
      } as Parameters<typeof createRuntimeAgentStreamResponse>[0],
      runtimeAgent,
      {
        sessionManager: new AgentRunSessionManager(),
        inferenceAuthToken: "run-scoped-inference-token",
      },
    );
    await response.text();

    assertEquals(capturedAuthorization, "Bearer run-scoped-inference-token");
  });
});
