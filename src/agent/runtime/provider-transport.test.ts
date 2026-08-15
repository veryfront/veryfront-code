import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { agent } from "../factory.ts";
import type { AgentRunModelCallContextEvent } from "../../runtime/model-call-context.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import type { ModelTransportRequest } from "../types.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

const originalLogLevel = Deno.env.get("LOG_LEVEL");

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

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

function normalizeRunRuntimeContext(
  event: AgentRunModelCallContextEvent,
): AgentRunModelCallContextEvent {
  return {
    ...event,
    messages: event.messages.map((message) =>
      message.role === "system" && typeof message.content === "string"
        ? {
          ...message,
          content: message.content.replace(
            /<runtime_context>[\s\S]*<\/runtime_context>/,
            "<runtime_context>\nserver-authored UTC snapshot\n</runtime_context>",
          ),
        }
        : message
    ),
  };
}

describe("agent provider transport hooks", () => {
  afterEach(() => {
    if (originalLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", originalLogLevel);
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
    clearModelProviders();
  });

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

  it("records equivalent context through cloud and server-local runtime paths", async () => {
    const contexts: AgentRunModelCallContextEvent[] = [];

    for (const provider of ["cloud", "local"] as const) {
      let runtimePrompt: unknown;
      const runtime: ModelRuntime = {
        provider,
        modelId: `${provider}/context-parity`,
        async doGenerate(options: unknown) {
          const prompt = (options as { prompt: unknown }).prompt;
          runtimePrompt = prompt;
          assertEquals(contexts.at(-1)?.messages, prompt);
          return {
            content: [{ type: "text", text: "done" }],
            finishReason: "stop",
            usage: {},
          };
        },
        async doStream() {
          return { stream: createTextStream([{ type: "finish" }]) };
        },
      };
      const assistant = agent({
        model: `${provider}/context-parity`,
        system: "Follow the same instructions.",
        skills: [],
        resolveModelTransport: () => ({ model: runtime }),
      });

      await runWithRunEventSink(
        (event) => {
          contexts.push(event as unknown as AgentRunModelCallContextEvent);
        },
        () => assistant.generate({ input: "Use the same normalized input." }),
      );

      assertEquals(contexts.at(-1)?.messages, runtimePrompt);
    }

    assertEquals(contexts.length, 2);
    const cloudContext = contexts[0];
    const localContext = contexts[1];
    assertExists(cloudContext);
    assertExists(localContext);
    assertEquals(
      normalizeRunRuntimeContext(cloudContext),
      normalizeRunRuntimeContext(localContext),
    );
    assertEquals(normalizeRunRuntimeContext(cloudContext), {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [
        {
          role: "system",
          content: "Follow the same instructions.",
          providerOptions: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        {
          role: "system",
          content: "<runtime_context>\nserver-authored UTC snapshot\n</runtime_context>",
        },
        {
          role: "user",
          content: [{ type: "text", text: "Use the same normalized input." }],
        },
      ],
    });
  });

  it("logs generate model remap diagnostics at debug level", async () => {
    const entries = captureLogs();
    registerModelProvider("google", (modelId) => ({
      provider: "google",
      modelId: `google/${modelId}`,
      async doGenerate() {
        return {
          content: [{ type: "text", text: "remapped generate" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    }));

    const assistant = agent({
      model: "google-ai-studio/gemini-3.1-pro-preview",
      system: "You are a helpful assistant.",
    });

    await assistant.generate({ input: "Hello" });

    const entry = entries.find((candidate) =>
      candidate.message ===
        '⚡ Using runtime model "google/gemini-3.1-pro-preview" instead of "google-ai-studio/gemini-3.1-pro-preview".'
    );
    assertEquals(entry?.level, "debug");
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

  it("logs stream model remap diagnostics at debug level", async () => {
    const entries = captureLogs();
    registerModelProvider("google", (modelId) => ({
      provider: "google",
      modelId: `google/${modelId}`,
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
            { type: "text-delta", text: "remapped stream" },
            { type: "finish" },
          ]),
        };
      },
    }));

    const assistant = agent({
      model: "google-ai-studio/gemini-3.1-pro-preview",
      system: "You are a helpful assistant.",
    });

    const response = (await assistant.stream({ input: "Hello" })).toDataStreamResponse();
    await response.text();

    const entry = entries.find((candidate) =>
      candidate.message ===
        '⚡ Using runtime model "google/gemini-3.1-pro-preview" instead of "google-ai-studio/gemini-3.1-pro-preview".'
    );
    assertEquals(entry?.level, "debug");
  });
});
