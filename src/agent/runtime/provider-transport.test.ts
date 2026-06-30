import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { agent } from "../factory.ts";
import type { ModelTransportRequest } from "../types.ts";

function createTextStream(
  parts: Array<
    | { type: "text-delta"; text: string }
    | { type: "finish"; finishReason?: string; totalUsage?: Record<string, unknown> }
  >,
) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

describe("agent provider transport hooks", () => {
  it("lets hosts override the model runtime and transport options for generate()", async () => {
    const captured: {
      request?: ModelTransportRequest;
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "hooked generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "host/test-model",
      system: "You are a helpful assistant.",
      resolveModelTransport: async (request) => {
        captured.request = request;
        return {
          model: transportModel,
          headers: { Authorization: "Bearer vf_test" },
          providerOptions: {
            veryfront: {
              projectSlug: request.context?.projectSlug,
            },
          },
        };
      },
    });

    const result = await assistant.generate({
      input: "Hello",
      context: { projectSlug: "demo-project" },
    });

    assertEquals(result.text, "hooked generate");
    assertEquals(captured.request, {
      agentId: assistant.id,
      requestedModel: "host/test-model",
      resolvedModel: "host/test-model",
      context: { projectSlug: "demo-project" },
      mode: "generate",
    });

    assertExists(captured.generateOptions);
    assertEquals(captured.generateOptions.temperature, 0);
    assertEquals(
      new Headers(captured.generateOptions.headers as HeadersInit).get("Authorization"),
      "Bearer vf_test",
    );
    assertEquals(captured.generateOptions.providerOptions, {
      veryfront: { projectSlug: "demo-project" },
    });
  });

  it("uses the agent-configured temperature for generate()", async () => {
    const captured: {
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "custom temperature" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "host/test-model",
      system: "You are a helpful assistant.",
      temperature: 0.2,
      resolveModelTransport: () => ({ model: transportModel }),
    });

    await assistant.generate({ input: "Hello" });

    assertExists(captured.generateOptions);
    assertEquals(captured.generateOptions.temperature, 0.2);
  });

  it("omits temperature for Claude Opus 4.8 generate requests", async () => {
    const captured: {
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "opus generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "anthropic/claude-opus-4-8",
      system: "You are a helpful assistant.",
      temperature: 0,
      resolveModelTransport: () => ({ model: transportModel }),
    });

    await assistant.generate({ input: "Hello" });

    assertExists(captured.generateOptions);
    assertEquals("temperature" in captured.generateOptions, false);
  });

  it("omits temperature for Claude Opus 4.8 stream requests", async () => {
    const captured: {
      streamOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        captured.streamOptions = options as Record<string, unknown>;
        return {
          stream: createTextStream([
            { type: "text-delta", text: "opus stream" },
            { type: "finish" },
          ]),
        };
      },
    };

    const assistant = agent({
      model: "anthropic/claude-opus-4-8",
      system: "You are a helpful assistant.",
      temperature: 0,
      resolveModelTransport: () => ({ model: transportModel }),
    });

    const response = (await assistant.stream({ input: "Hello" })).toDataStreamResponse();
    const body = await response.text();

    assertStringIncludes(body, "opus stream");
    assertExists(captured.streamOptions);
    assertEquals("temperature" in captured.streamOptions, false);
  });

  it("emits accumulated usage on stream message-finish events", async () => {
    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        return {
          stream: createTextStream([
            { type: "text-delta", text: "usage stream" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: {
                inputTokens: 12,
                outputTokens: 8,
                totalTokens: 20,
                costCredits: 0.25,
              },
            },
          ]),
        };
      },
    };

    const assistant = agent({
      model: "host/test-model",
      system: "You are a helpful assistant.",
      resolveModelTransport: () => ({ model: transportModel }),
    });

    const response = (await assistant.stream({ input: "Hello" })).toDataStreamResponse();
    const body = await response.text();

    assertStringIncludes(body, '"type":"message-finish"');
    assertStringIncludes(body, '"finishReason":"stop"');
    assertStringIncludes(body, '"inputTokens":12');
    assertStringIncludes(body, '"outputTokens":8');
    assertStringIncludes(body, '"totalTokens":20');
    assertStringIncludes(body, '"costCredits":0.25');
  });

  it("omits temperature for Veryfront Cloud Claude Opus 4.8 generate requests", async () => {
    const captured: {
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "cloud opus generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "veryfront-cloud/anthropic/claude-opus-4-8",
      system: "You are a helpful assistant.",
      temperature: 0,
      resolveModelTransport: () => ({ model: transportModel }),
    });

    await assistant.generate({ input: "Hello" });

    assertExists(captured.generateOptions);
    assertEquals("temperature" in captured.generateOptions, false);
  });

  it("uses fixed temperature for Veryfront Cloud Kimi 2.6 generate requests", async () => {
    const captured: {
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "kimi generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const assistant = agent({
      model: "veryfront-cloud/moonshotai/kimi-k2.6",
      system: "You are a helpful assistant.",
      temperature: 0,
      resolveModelTransport: () => ({ model: transportModel }),
    });

    await assistant.generate({ input: "Hello" });

    assertExists(captured.generateOptions);
    assertEquals(captured.generateOptions.temperature, 1);
  });

  it("uses non-thinking fixed temperature for Veryfront Cloud Kimi 2.6 generate requests", async () => {
    const captured: {
      generateOptions?: Record<string, unknown>;
    } = {};

    const transportModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/gateway-model",
      async doGenerate(options: unknown) {
        captured.generateOptions = options as Record<string, unknown>;
        return {
          content: [{ type: "text", text: "kimi non-thinking generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };

    const providerOptions = {
      openai: {
        extraBody: {
          thinking: { type: "disabled" },
        },
      },
    };
    const assistant = agent({
      model: "veryfront-cloud/moonshotai/kimi-k2.6",
      system: "You are a helpful assistant.",
      temperature: 0,
      resolveModelTransport: () => ({ model: transportModel, providerOptions }),
    });

    await assistant.generate({ input: "Hello" });

    assertExists(captured.generateOptions);
    assertEquals(captured.generateOptions.temperature, 0.6);
    assertEquals(captured.generateOptions.providerOptions, providerOptions);
  });

  it("preserves temperature for other hosted models", async () => {
    const cases = [
      { model: "anthropic/claude-sonnet-4-6", temperature: 0 },
      { model: "openai/gpt-5.5", temperature: 0.2 },
      { model: "google-ai-studio/gemini-3.1-pro-preview", temperature: 0.7 },
    ];

    for (const testCase of cases) {
      const captured: {
        generateOptions?: Record<string, unknown>;
      } = {};

      const transportModel: ModelRuntime = {
        provider: "hosted",
        modelId: "hosted/gateway-model",
        async doGenerate(options: unknown) {
          captured.generateOptions = options as Record<string, unknown>;
          return {
            content: [{ type: "text", text: "other model generate" }],
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
        async doStream() {
          return { stream: createTextStream([{ type: "finish" }]) };
        },
      };

      const assistant = agent({
        model: testCase.model,
        system: "You are a helpful assistant.",
        temperature: testCase.temperature,
        resolveModelTransport: () => ({ model: transportModel }),
      });

      await assistant.generate({ input: "Hello" });

      assertExists(captured.generateOptions);
      assertEquals(captured.generateOptions.temperature, testCase.temperature);
    }
  });

  it("lets hosts attach request-aware transport options while still using the registered provider runtime for stream()", async () => {
    const captured: {
      request?: ModelTransportRequest;
      streamOptions?: Record<string, unknown>;
    } = {};

    registerModelProvider("transport-stream-test", (_modelId) => ({
      provider: "transport-stream-test",
      modelId: "transport-stream-test/demo",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        captured.streamOptions = options as Record<string, unknown>;
        return {
          stream: createTextStream([
            { type: "text-delta", text: "streamed via provider hook" },
            { type: "finish" },
          ]),
        };
      },
    }));

    const assistant = agent({
      model: "transport-stream-test/demo",
      system: "You are a helpful assistant.",
      resolveModelTransport: async (request) => {
        captured.request = request;
        return {
          headers: { "x-veryfront-project": String(request.context?.projectSlug ?? "") },
          providerOptions: {
            gateway: {
              branchId: request.context?.branchId,
            },
          },
        };
      },
    });

    const response = (await assistant.stream({
      input: "Hello",
      context: { projectSlug: "demo-project", branchId: "branch_123" },
    })).toDataStreamResponse();
    const body = await response.text();

    assertStringIncludes(body, "streamed via provider hook");
    assertEquals(captured.request, {
      agentId: assistant.id,
      requestedModel: "transport-stream-test/demo",
      resolvedModel: "transport-stream-test/demo",
      context: { projectSlug: "demo-project", branchId: "branch_123" },
      mode: "stream",
    });

    assertExists(captured.streamOptions);
    assertEquals(
      new Headers(captured.streamOptions.headers as HeadersInit).get("x-veryfront-project"),
      "demo-project",
    );
    assertEquals(captured.streamOptions.providerOptions, {
      gateway: { branchId: "branch_123" },
    });
  });
});
