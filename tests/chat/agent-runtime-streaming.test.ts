import { describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat";
import { type AgentConfig, type Message } from "../../src/agent/types.ts";
import type { ModelRuntime } from "../../src/provider/types.ts";

function assert(condition: unknown, message?: string): void {
  if (!condition) throw new Error(message || "Assertion failed");
}

function createMockStreamingModel(
  provider: string,
  modelId: string,
  doStream: ModelRuntime["doStream"],
): ModelRuntime {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
    doGenerate: async () => ({
      content: [],
      finishReason: { unified: "stop", raw: "stop" },
    }),
    doStream,
  };
}

/**
 * Integration test for AgentRuntime streaming via the public `stream()` API.
 *
 * Registers a mock model in the model registry, invokes `runtime.stream()`,
 * and verifies SSE events are emitted correctly.
 */
describe("AgentRuntime streaming", () => {
  it("should stream text content via the model registry", async () => {
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
      clearModelProviders();

      const mockModel = createMockStreamingModel(
        "mock",
        "mock-model",
        async () => ({
          stream: ReadableStream.from([
            { type: "text-delta", delta: "Hello " },
            { type: "text-delta", delta: "from mock" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 5 },
                outputTokens: { total: 3 },
              },
            },
          ]),
        }),
      );

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
      clearModelProviders();

      let providerAbortSignal: AbortSignal | undefined;

      const mockModel = createMockStreamingModel(
        "mock",
        "mock-model",
        async (options) => {
          const streamOptions = options as { abortSignal?: AbortSignal };
          providerAbortSignal = streamOptions.abortSignal;

          return {
            stream: new ReadableStream({
              start(controller) {
                streamOptions.abortSignal?.addEventListener("abort", () => {
                  controller.error(
                    streamOptions.abortSignal?.reason ??
                      new DOMException("The operation was aborted", "AbortError"),
                  );
                }, { once: true });
              },
            }),
          };
        },
      );

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
      if (!providerAbortSignal) {
        throw new Error("provider abort signal should be passed to streamText");
      }
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
