import { describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat";
import {
  type AgentConfig,
  type Message,
} from "../../src/agent/types.ts";

function assert(condition: unknown, message?: string): void {
  if (!condition) throw new Error(message || "Assertion failed");
}

/**
 * Integration test for AgentRuntime streaming via the public `stream()` API.
 *
 * Registers a mock model in the model registry, invokes `runtime.stream()`,
 * and verifies SSE events are emitted correctly.
 */
describe("AgentRuntime streaming with AI SDK", () => {
  it("should stream text content via AI SDK model registry", async () => {
    const originalLogLevel = getEnv("LOG_LEVEL");
    const originalNodeEnv = getEnv("NODE_ENV");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");

    try {
      const { AgentRuntime } = await import("../../src/agent/runtime/index.ts");
      const { registerModelProvider, clearModelProviders } = await import(
        "../../src/provider/model-registry.ts"
      );
      const { MockLanguageModelV3, simulateReadableStream } = await import("ai/test");

      clearModelProviders();

      const mockModel = new MockLanguageModelV3({
        provider: "mock",
        modelId: "mock-model",
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "Hello " },
              { type: "text-delta" as const, id: "text-1", delta: "from mock" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { type: "stop" as const },
                usage: { inputTokens: 5, outputTokens: 3 },
              },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      registerModelProvider("mock", () => mockModel);

      const baseConfig: AgentConfig = {
        id: "test-agent",
        model: "mock/mock-model",
        system: "You are a tester",
        memory: { type: "conversation", maxTokens: 4000 },
      };

      const runtime = new AgentRuntime("test", baseConfig);
      const messages: Message[] = [{
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      }];

      const stream = await runtime.stream(messages);

      // Read the SSE events from the stream
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let output = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }

      // Verify SSE events contain our streamed text
      assert(output.includes("message-start"), "should emit message-start event");
      assert(output.includes("text-delta"), "should emit text-delta events");
      assert(output.includes("Hello "), "should include first text chunk");
      assert(output.includes("from mock"), "should include second text chunk");
      assert(output.includes("message-finish"), "should emit message-finish event");

      // Cleanup
      clearModelProviders();
    } finally {
      restoreEnv("LOG_LEVEL", originalLogLevel);
      restoreEnv("NODE_ENV", originalNodeEnv);
    }
  });
});

function restoreEnv(key: string, originalValue: string | undefined): void {
  if (originalValue === undefined) {
    deleteEnv(key);
    return;
  }
  setEnv(key, originalValue);
}
