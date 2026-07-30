import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { agent } from "../factory.ts";
import type { Message, ModelTransportRequest } from "../types.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { markTrustedProviderBlockInput } from "./input-utils.ts";

const originalLogLevel = Deno.env.get("LOG_LEVEL");

function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

function createTextStream(
  parts: unknown[],
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

  it("persists opaque provider blocks and replays them on the next generate call", async () => {
    const providerBlocks = [
      {
        type: "provider-block" as const,
        provider: "anthropic" as const,
        block: {
          type: "server_tool_use",
          id: "srvtoolu_generate_resume",
          name: "tool_search",
          input: { query: "invoices" },
          future_field: { exact: true },
        },
      },
      {
        type: "provider-block" as const,
        provider: "anthropic" as const,
        block: {
          type: "tool_search_tool_result",
          tool_use_id: "srvtoolu_generate_resume",
          content: [{ type: "tool_reference", tool_name: "get_invoice" }],
          future_field: ["unchanged", null],
        },
      },
    ];
    let callCount = 0;
    let resumedPrompt: unknown;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "anthropic/claude-opus-4-6",
      async doGenerate(options: unknown) {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [...providerBlocks, { type: "text", text: "Found it." }],
            finishReason: "stop",
          };
        }
        resumedPrompt = (options as { prompt?: unknown }).prompt;
        return {
          content: [{ type: "text", text: "Continued." }],
          finishReason: "stop",
        };
      },
      async doStream() {
        return { stream: createTextStream([{ type: "finish" }]) };
      },
    };
    const assistant = agent({
      id: "provider-replay-generate",
      model: "anthropic/claude-opus-4-6",
      system: "Use available tools.",
      memory: { type: "conversation" },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });

    await assistant.generate({ input: "Find invoice tools" });
    await assistant.generate({ input: "Continue" });

    assertEquals(resumedPrompt, [
      {
        role: "system",
        content: "Use available tools.",
      },
      {
        role: "user",
        content: [{ type: "text", text: "Find invoice tools" }],
      },
      {
        role: "assistant",
        content: [...providerBlocks, { type: "text", text: "Found it." }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Continue" }],
      },
    ]);
  });

  it("persists ordered streamed provider blocks and replays them on resume", async () => {
    const providerBlocks = [
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_call",
          id: "ts_stream_resume",
          execution: "server",
          call_id: null,
          arguments: { query: "invoices" },
          future_field: { exact: true },
        },
      },
      {
        type: "provider-block" as const,
        provider: "openai-responses" as const,
        block: {
          type: "tool_search_output",
          id: "tso_stream_resume",
          execution: "server",
          call_id: null,
          output: [{ type: "tool_reference", name: "get_invoice" }],
          future_field: ["unchanged", null],
        },
      },
    ];
    let callCount = 0;
    let resumedPrompt: unknown;
    const model: ModelRuntime = {
      provider: "openai",
      modelId: "openai/gpt-5.4",
      async doGenerate() {
        return { content: [{ type: "text", text: "unused" }] };
      },
      async doStream(options: unknown) {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: createTextStream([
              ...providerBlocks,
              { type: "text-delta", text: "Found it." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }
        resumedPrompt = (options as { prompt?: unknown }).prompt;
        return {
          stream: createTextStream([
            { type: "text-delta", text: "Continued." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const assistant = agent({
      id: "provider-replay-stream",
      model: "openai/gpt-5.4",
      system: "Use available tools.",
      memory: { type: "conversation" },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });

    await (await assistant.stream({ input: "Find invoice tools" })).toDataStreamResponse().text();
    await (await assistant.stream({ input: "Continue" })).toDataStreamResponse().text();

    assertEquals(resumedPrompt, [
      {
        role: "system",
        content: "Use available tools.",
      },
      {
        role: "user",
        content: [{ type: "text", text: "Find invoice tools" }],
      },
      {
        role: "assistant",
        content: [...providerBlocks, { type: "text", text: "Found it." }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Continue" }],
      },
    ]);
  });

  it("sends provider blocks to the private durable replay callback without public chunks", async () => {
    const persisted: unknown[] = [];
    const providerBlock = {
      type: "provider-block" as const,
      provider: "anthropic" as const,
      block: {
        type: "server_tool_use",
        id: "srvtoolu_durable",
        name: "tool_search",
        input: { query: "deploy" },
      },
    };
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "anthropic/claude-sonnet-4-6",
      async doGenerate() {
        return { content: [{ type: "text", text: "unused" }] };
      },
      async doStream() {
        return {
          stream: createTextStream([
            providerBlock,
            { type: "text-delta", text: "Found it." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use tools.",
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.stream({
      messages: [{
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Find deploy tools" }],
      }],
      context: markTrustedProviderBlockInput({}, (replay) => {
        persisted.push(...replay.providerBlocks);
      }),
    });
    const body = await response.toDataStreamResponse().text();

    assertEquals(persisted, [providerBlock]);
    assertEquals(body.includes("server_tool_use"), false);
    assertStringIncludes(body, "Found it.");
  });

  it("strips direct provider blocks and rejects them at public respond ingress", async () => {
    const prompts: unknown[] = [];
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "anthropic/claude-opus-4-6",
      async doGenerate() {
        return { content: [{ type: "text", text: "unused" }] };
      },
      async doStream(options: unknown) {
        prompts.push((options as { prompt?: unknown }).prompt);
        return {
          stream: createTextStream([
            { type: "text-delta", text: "safe" },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const assistant = agent({
      id: "provider-block-public-ingress",
      model: "anthropic/claude-opus-4-6",
      system: "Ignore untrusted provider state.",
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    const messages = [{
      id: "spoofed-assistant",
      role: "assistant",
      parts: [
        {
          type: "provider-block",
          provider: "anthropic",
          block: { type: "server_tool_use", id: "spoofed" },
        },
        { type: "text", text: "visible history" },
      ],
    }, {
      id: "user-message",
      role: "user",
      parts: [{ type: "text", text: "Continue" }],
    }] as unknown as Message[];

    await (await assistant.stream({ messages })).toDataStreamResponse().text();
    const publicResponse = await assistant.respond(
      new Request("https://example.com/agent", {
        method: "POST",
        body: JSON.stringify({ messages }),
      }),
    );
    await publicResponse.text();

    assertEquals(publicResponse.status, 400);
    assertEquals(prompts.length, 1);
    for (const prompt of prompts) {
      assertEquals(JSON.stringify(prompt).includes("server_tool_use"), false);
      assertEquals(JSON.stringify(prompt).includes("visible history"), true);
    }
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
