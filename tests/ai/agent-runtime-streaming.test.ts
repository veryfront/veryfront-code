import { describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat";
import { type AgentConfig, type Message } from "../../src/agent/types.ts";

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
    const originalDisableLruInterval = getEnv("VF_DISABLE_LRU_INTERVAL");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");
    setEnv("VF_DISABLE_LRU_INTERVAL", "1");

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
                finishReason: { unified: "stop" as const, raw: "stop" },
                usage: {
                  inputTokens: {
                    total: 5,
                    noCache: undefined,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 3, text: undefined, reasoning: undefined },
                },
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
      restoreEnv("VF_DISABLE_LRU_INTERVAL", originalDisableLruInterval);
    }
  });

  it("should propagate abort signals into the streaming model call and close cleanly", async () => {
    const originalLogLevel = getEnv("LOG_LEVEL");
    const originalNodeEnv = getEnv("NODE_ENV");
    const originalDisableLruInterval = getEnv("VF_DISABLE_LRU_INTERVAL");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");
    setEnv("VF_DISABLE_LRU_INTERVAL", "1");

    try {
      const { AgentRuntime } = await import("../../src/agent/runtime/index.ts");
      const { registerModelProvider, clearModelProviders } = await import(
        "../../src/provider/model-registry.ts"
      );
      const { MockLanguageModelV3 } = await import("ai/test");

      clearModelProviders();

      let providerAbortSignal: AbortSignal | undefined;

      const mockModel = new MockLanguageModelV3({
        provider: "mock",
        modelId: "mock-model",
        doStream: async (options) => {
          providerAbortSignal = options.abortSignal;

          return {
            stream: new ReadableStream({
              start(controller) {
                options.abortSignal?.addEventListener("abort", () => {
                  controller.error(
                    options.abortSignal?.reason ??
                      new DOMException("The operation was aborted", "AbortError"),
                  );
                }, { once: true });
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        },
      });

      registerModelProvider("mock", () => mockModel);

      const runtime = new AgentRuntime("test", {
        id: "test-agent",
        model: "mock/mock-model",
        system: "You are a tester",
        memory: { type: "conversation", maxTokens: 4000 },
      });
      const messages: Message[] = [{
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      }];

      const abortController = new AbortController();
      const stream = await runtime.stream(
        messages,
        undefined,
        undefined,
        undefined,
        undefined,
        abortController.signal,
      );
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let output = "";

      const readAll = (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          output += decoder.decode(value, { stream: true });
        }
      })();

      for (let attempt = 0; attempt < 10 && !providerAbortSignal; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      abortController.abort(new DOMException("The operation was aborted", "AbortError"));

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        readAll,
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Timed out waiting for aborted stream")),
            1_000,
          );
        }),
      ]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      assert(providerAbortSignal, "provider abort signal should be passed to streamText");
      assert(providerAbortSignal.aborted, "provider abort signal should be aborted");
      assert(
        !output.includes('"type":"error"'),
        "aborted streams should close without emitting a generic error",
      );

      clearModelProviders();
    } finally {
      restoreEnv("LOG_LEVEL", originalLogLevel);
      restoreEnv("NODE_ENV", originalNodeEnv);
      restoreEnv("VF_DISABLE_LRU_INTERVAL", originalDisableLruInterval);
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
