import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { createWarningCollector } from "#veryfront/provider/shared/index.ts";
import type { AgentRunModelCallContextEvent } from "#veryfront/runtime/model-call-context.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorModelRuntimeResolver } from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { createHostedExecutorModelBroker } from "#veryfront/agent/hosted/executor-model-dispatch.ts";
import { buildGoogleGenerateContentRequest } from "../../../extensions/ext-llm-google/src/google-request-builder.ts";
import { buildAnthropicMessagesRequest } from "../../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";
import { buildOpenAIChatRequest } from "../../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";
import { buildOpenAIResponsesRequest } from "../../../extensions/ext-llm-openai/src/openai-responses-request-builder.ts";

const options: ModelRuntimeCallOptions = {
  prompt: [{ role: "system", content: "Captured system" }, {
    role: "user",
    content: [{ type: "text", text: "Captured prompt" }],
  }],
  tools: [{ type: "function", name: "lookup", inputSchema: { type: "object", properties: {} } }],
  maxOutputTokens: 12,
  temperature: 0.4,
};

type Builder = (options: ModelRuntimeCallOptions) => Record<string, unknown>;

async function connected(provider: string, build: Builder) {
  const modelId = `veryfront-cloud/${provider}/synthetic`;
  const allowedModelIds = new Set([modelId]);
  const binding = {
    allocationId: "allocation-test",
    generation: 1,
    invocationId: "invocation-test",
  };
  const events: AgentRunModelCallContextEvent[] = [];
  const bodies: Record<string, unknown>[] = [];
  const operations = createHostedExecutorModelBroker({
    allowedModelIds,
    scope: { binding, signal: new AbortController().signal, assertActive() {} },
    runEventSink: (event) => {
      events.push(event);
    },
    resolveModelRuntime: () => ({
      provider: "veryfront-cloud",
      modelProvider: provider,
      modelId: "synthetic",
      doGenerate(call: ModelRuntimeCallOptions) {
        bodies.push(build(call));
        return Promise.resolve({});
      },
      doStream() {
        throw new Error("Stream is not used by this offline builder fixture");
      },
    }),
  });
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  const resolver = await createExecutorModelRuntimeResolver({ channel: caller, allowedModelIds });
  return {
    runtime: resolver(modelId)!,
    events,
    bodies,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

describe("hosted executor model request contracts", () => {
  it("rejects native fields that the first-party builders would merge over captured input", async () => {
    const cases: { provider: string; build: Builder; overrides: Record<string, unknown> }[] = [
      {
        provider: "google",
        build: (call) => ({
          ...buildGoogleGenerateContentRequest("veryfront-cloud", call, createWarningCollector()),
        }),
        overrides: {
          contents: [{ role: "user", parts: [{ text: "Other prompt" }] }],
          systemInstruction: { parts: [{ text: "Other system" }] },
          tools: [],
        },
      },
      {
        provider: "anthropic",
        build: (call) => ({
          ...buildAnthropicMessagesRequest(
            "claude-haiku-4-5",
            "veryfront-cloud",
            call,
            false,
            createWarningCollector(),
          ),
        }),
        overrides: {
          messages: [{ role: "user", content: [{ type: "text", text: "Other prompt" }] }],
          system: "Other system",
          tools: [],
          max_tokens: 99,
          temperature: 0.9,
        },
      },
      {
        provider: "openai",
        build: (call) => ({
          ...buildOpenAIChatRequest(
            "gpt-4o",
            "veryfront-cloud",
            call,
            false,
            createWarningCollector(),
          ),
        }),
        overrides: { tools: [], max_completion_tokens: 99, temperature: 0.9 },
      },
      {
        provider: "openai",
        build: (call) => ({
          ...buildOpenAIResponsesRequest(
            "gpt-4o",
            "veryfront-cloud",
            call,
            false,
            createWarningCollector(),
          ),
        }),
        overrides: { tools: [], max_output_tokens: 99, temperature: 0.9 },
      },
    ];
    for (const testCase of cases) {
      const channels = await connected(testCase.provider, testCase.build);
      try {
        await channels.runtime.doGenerate(options);
        assertEquals<unknown>(channels.events[0]?.messages, options.prompt);
        assertEquals(channels.events[0]?.tools, options.tools);
        assertEquals(channels.bodies, [testCase.build(options)]);
        for (const bucket of [testCase.provider, "veryfront-cloud"]) {
          for (const [field, value] of Object.entries(testCase.overrides)) {
            const overridden = { ...options, providerOptions: { [bucket]: { [field]: value } } };
            assertNotEquals(testCase.build(overridden)[field], testCase.build(options)[field]);
            await assertRejects(
              async () => await channels.runtime.doGenerate(overridden),
              Error,
              "operation-failed",
            );
          }
        }
        assertEquals(channels.events.length, 1);
        assertEquals(channels.bodies.length, 1);
      } finally {
        await channels.close();
      }
    }
  });

  it("preserves a native Google response schema with exact neutral control and reasoning values", async () => {
    const responseSchema = {
      type: "OBJECT",
      properties: {
        contents: { type: "STRING" },
        tools: { type: "STRING" },
        temperature: { type: "NUMBER" },
      },
    };
    const channels = await connected(
      "google",
      (call) => ({
        ...buildGoogleGenerateContentRequest("veryfront-cloud", call, createWarningCollector()),
      }),
    );
    try {
      const reasonings = [
        { enabled: true, effort: "low" },
        { enabled: true, effort: "medium" },
        { enabled: true, effort: "high" },
        { enabled: true, effort: "max" },
        { enabled: true, budgetTokens: 4096 },
      ] as const;
      for (const reasoning of reasonings) {
        const baseline = buildGoogleGenerateContentRequest("veryfront-cloud", {
          ...options,
          reasoning,
        }, createWarningCollector());
        const generationConfig = {
          ...baseline.generationConfig,
          responseMimeType: "application/json",
          responseSchema,
        };
        await channels.runtime.doGenerate({
          ...options,
          reasoning,
          providerOptions: { google: { generationConfig } },
        });
        assertEquals(channels.bodies.at(-1)?.generationConfig, generationConfig);
        assertEquals(channels.events.at(-1)?.request, {
          maxOutputTokens: 12,
          temperature: 0.4,
          reasoning,
        });
      }
      await assertRejects(
        async () =>
          await channels.runtime.doGenerate({
            ...options,
            providerOptions: { google: { generationConfig: { responseSchema } } },
          }),
        Error,
        "operation-failed",
      );
      assertEquals(channels.events.length, reasonings.length);
      assertEquals(channels.bodies.length, reasonings.length);
    } finally {
      await channels.close();
    }
  });
});
