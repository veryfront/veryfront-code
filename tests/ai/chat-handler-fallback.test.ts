/**
 * Tests for the chat handler's 503 fallback response and
 * the structured no_ai_available error flow.
 */
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat";

import { createError, fromError, toError } from "../../src/errors/veryfront-error.ts";

describe("no_ai_available error type", () => {
  it("creates a structured error with type no_ai_available", () => {
    const errorData = createError({
      type: "no_ai_available",
      message: "ONNX not supported",
    });

    assertEquals(errorData.type, "no_ai_available");
    assertEquals(errorData.message, "ONNX not supported");
  });

  it("round-trips through toError and fromError", () => {
    const errorData = createError({
      type: "no_ai_available",
      message: "Local AI unavailable",
    });

    const thrown = toError(errorData);
    assertEquals(thrown instanceof Error, true);
    assertEquals(thrown.message, "Local AI unavailable");
    assertEquals(thrown.name, "VeryfrontError[no_ai_available]");

    const recovered = fromError(thrown);
    assertEquals(recovered?.type, "no_ai_available");
    assertEquals(recovered?.message, "Local AI unavailable");
  });

  it("fromError returns null for plain errors", () => {
    const plainError = new Error("plain");
    const result = fromError(plainError);
    assertEquals(result, null);
  });
});

describe("chat-handler 503 fallback", () => {
  it("returns 503 with NO_AI_AVAILABLE when agent stream throws no_ai_available", async () => {
    const originalLogLevel = getEnv("LOG_LEVEL");
    const originalNodeEnv = getEnv("NODE_ENV");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");

    try {
      const { registerAgent } = await import(
        "../../src/agent/composition/composition.ts"
      );
      const { createChatHandler } = await import(
        "../../src/agent/chat-handler.ts"
      );

      // Register a fake agent whose stream() throws no_ai_available
      const noAiError = toError(
        createError({
          type: "no_ai_available",
          message: "ONNX not available in compiled binary",
        }),
      );

      const fakeAgent = {
        id: "test-fallback",
        config: {
          model: "local/smollm2-135m",
          system: "You are a test bot.",
        },
        generate: async () => {
          throw noAiError;
        },
        stream: async () => {
          throw noAiError;
        },
        respond: async () => {
          throw noAiError;
        },
        clearMemory: async () => {},
      };

      // deno-lint-ignore no-explicit-any
      registerAgent("test-fallback", fakeAgent as any);

      const handler = createChatHandler("test-fallback");
      const request = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });

      const response = await handler(request);
      assertEquals(response.status, 503);

      const body = await response.json();
      assertEquals(body.code, "NO_AI_AVAILABLE");
      assertEquals(body.fallback, "browser");
      assertEquals(body.model, "smollm2-135m");
      // System prompt must NOT be sent to the client (security: C2)
      assertEquals(body.systemPrompt, undefined);
    } finally {
      if (originalLogLevel) setEnv("LOG_LEVEL", originalLogLevel);
      if (originalNodeEnv) setEnv("NODE_ENV", originalNodeEnv);
    }
  });

  it("returns 500 for non-no_ai_available errors", async () => {
    const originalLogLevel = getEnv("LOG_LEVEL");
    const originalNodeEnv = getEnv("NODE_ENV");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");

    try {
      const { registerAgent } = await import(
        "../../src/agent/composition/composition.ts"
      );
      const { createChatHandler } = await import(
        "../../src/agent/chat-handler.ts"
      );

      const fakeAgent = {
        id: "test-generic-error",
        config: {
          model: "openai/gpt-4o",
          system: "You are a test bot.",
        },
        generate: async () => {
          throw new Error("Some other error");
        },
        stream: async () => {
          throw new Error("Some other error");
        },
        respond: async () => {
          throw new Error("Some other error");
        },
        clearMemory: async () => {},
      };

      // deno-lint-ignore no-explicit-any
      registerAgent("test-generic-error", fakeAgent as any);

      const handler = createChatHandler("test-generic-error");
      const request = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });

      const response = await handler(request);
      assertEquals(response.status, 500);

      const body = await response.json();
      assertEquals(body.error, "Internal server error");
    } finally {
      if (originalLogLevel) setEnv("LOG_LEVEL", originalLogLevel);
      if (originalNodeEnv) setEnv("NODE_ENV", originalNodeEnv);
    }
  });
});

describe("runtime inference mode metadata", () => {
  it("emits cloud inferenceMode for non-local provider", async () => {
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
              { type: "text-delta" as const, id: "text-1", delta: "Hi" },
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
                  outputTokens: { total: 1, text: undefined, reasoning: undefined },
                },
              },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      // Register as "mock" provider to test cloud inferenceMode detection
      registerModelProvider("mock", () => mockModel);

      const runtime = new AgentRuntime("test-mode", {
        model: "mock/test-model",
        system: "Test",
      });

      const stream = await runtime.stream(
        [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hi" }] }],
        undefined,
        undefined,
        "mock/test-model",
      );

      // Read all SSE events from the stream
      const decoder = new TextDecoder();
      const reader = stream.getReader();
      const events: Array<Record<string, unknown>> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch {
              // skip non-JSON lines
            }
          }
        }
      }

      // Find the data event with inferenceMode
      const dataEvent = events.find(
        (e) => e.type === "data" && typeof e.data === "object",
      );
      assertEquals(dataEvent !== undefined, true, "Should have a data event");
      const dataPayload = dataEvent?.data as { inferenceMode: string; model: string };
      assertEquals(dataPayload.inferenceMode, "cloud");
      assertEquals(dataPayload.model, "mock/test-model", "model field should match requested cloud model");
    } finally {
      if (originalLogLevel) setEnv("LOG_LEVEL", originalLogLevel);
      if (originalNodeEnv) setEnv("NODE_ENV", originalNodeEnv);
    }
  });

  it("emits server-local inferenceMode when cloud provider falls back to local", async () => {
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

      registerModelProvider("openai", () => {
        throw toError(
          createError({
            type: "config",
            message: "OPENAI_API_KEY missing",
          }),
        );
      });

      const mockLocal = new MockLanguageModelV3({
        provider: "local",
        modelId: "smollm2-135m",
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "Hi" },
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
                  outputTokens: {
                    total: 1,
                    text: undefined,
                    reasoning: undefined,
                  },
                },
              },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      registerModelProvider("local", () => mockLocal);

      const runtime = new AgentRuntime("test-cloud-fallback-mode", {
        model: "openai/gpt-4o",
        system: "Test",
      });

      const stream = await runtime.stream(
        [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hi" }] }],
        undefined,
        undefined,
        "openai/gpt-4o",
      );

      const decoder = new TextDecoder();
      const reader = stream.getReader();
      const events: Array<Record<string, unknown>> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch {
              // skip non-JSON lines
            }
          }
        }
      }

      const dataEvent = events.find(
        (e) => e.type === "data" && typeof e.data === "object",
      );
      assertEquals(dataEvent !== undefined, true, "Should have a data event");
      const dataPayload = dataEvent?.data as { inferenceMode: string; model: string };
      assertEquals(dataPayload.inferenceMode, "server-local");
      // effectiveModel: requested "openai/gpt-4o" fell back to local — model should reflect the local modelId
      assertEquals(
        dataPayload.model,
        "local/smollm2-135m",
        "model field should reflect the resolved local model, not the originally requested cloud model",
      );
    } finally {
      if (originalLogLevel) setEnv("LOG_LEVEL", originalLogLevel);
      if (originalNodeEnv) setEnv("NODE_ENV", originalNodeEnv);
    }
  });

  it("auto-upgrades local model to cloud when API key is available", async () => {
    const originalLogLevel = getEnv("LOG_LEVEL");
    const originalNodeEnv = getEnv("NODE_ENV");
    const origAnthropicKey = getEnv("ANTHROPIC_API_KEY");

    setEnv("LOG_LEVEL", "silent");
    setEnv("NODE_ENV", "test");
    setEnv("ANTHROPIC_API_KEY", "sk-test-key");

    try {
      const { AgentRuntime } = await import("../../src/agent/runtime/index.ts");
      const { registerModelProvider, clearModelProviders } = await import(
        "../../src/provider/model-registry.ts"
      );
      const { MockLanguageModelV3, simulateReadableStream } = await import("ai/test");

      clearModelProviders();

      const mockCloud = new MockLanguageModelV3({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "Hi from cloud" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: "stop" },
                usage: {
                  inputTokens: { total: 5, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 3, text: undefined, reasoning: undefined },
                },
              },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });

      registerModelProvider("anthropic", () => mockCloud);

      // Agent configured with local model, but cloud key is available
      const runtime = new AgentRuntime("test-auto-upgrade", {
        model: "local/smollm2-135m",
        system: "Test",
      });

      const stream = await runtime.stream(
        [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hi" }] }],
        undefined,
        undefined,
        "local/smollm2-135m",
      );

      const decoder = new TextDecoder();
      const reader = stream.getReader();
      const events: Array<Record<string, unknown>> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ")) {
            try { events.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
          }
        }
      }

      const dataEvent = events.find(
        (e) => e.type === "data" && typeof e.data === "object",
      );
      assertEquals(dataEvent !== undefined, true, "Should have a data event");
      const dataPayload = dataEvent?.data as { inferenceMode: string; model: string };
      assertEquals(dataPayload.inferenceMode, "cloud");
      // Auto-upgraded from local to anthropic — model should be the cloud model string
      assertEquals(
        dataPayload.model,
        "anthropic/claude-sonnet-4-20250514",
        "model field should reflect the upgraded cloud model",
      );
    } finally {
      if (originalLogLevel) setEnv("LOG_LEVEL", originalLogLevel);
      if (originalNodeEnv) setEnv("NODE_ENV", originalNodeEnv);
      if (origAnthropicKey != null) setEnv("ANTHROPIC_API_KEY", origAnthropicKey); else deleteEnv("ANTHROPIC_API_KEY");
    }
  });
});
