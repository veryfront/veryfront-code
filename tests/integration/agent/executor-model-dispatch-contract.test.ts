import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
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

type Builder = (options: ModelRuntimeCallOptions, stream?: boolean) => Record<string, unknown>;

async function connected(provider: string, build: Builder, maxOutputTokens = 4096) {
  const modelId = `veryfront-cloud/${provider}/synthetic`;
  const allowedModelIds = new Set([modelId]);
  const binding = {
    allocationId: "allocation-test",
    generation: 1,
    invocationId: "invocation-test",
  };
  const events: AgentRunModelCallContextEvent[] = [];
  const bodies: Record<string, unknown>[] = [];
  const calls: ModelRuntimeCallOptions[] = [];
  const operations = createHostedExecutorModelBroker({
    grant: {
      maxCalls: 64,
      maxConcurrentCalls: 2,
      models: new Map([[modelId, { maxOutputTokens, providerTools: [] }]]),
    },
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
        calls.push(call);
        bodies.push(build(call, false));
        return Promise.resolve({});
      },
      doStream(call: ModelRuntimeCallOptions) {
        calls.push(call);
        bodies.push(build(call, true));
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        });
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
    calls,
    async close() {
      caller.close();
      await broker.closed;
    },
  };
}

describe("hosted executor model request contracts", () => {
  it("rejects completion multipliers at provider roots before generate or stream dispatch", async () => {
    const cases: { provider: string; build: Builder }[] = [
      {
        provider: "openai",
        build: (call, stream = false) => ({
          ...buildOpenAIChatRequest(
            "gpt-4o",
            "veryfront-cloud",
            call,
            stream,
            createWarningCollector(),
          ),
        }),
      },
      {
        provider: "openai",
        build: (call, stream = false) => ({
          ...buildOpenAIResponsesRequest(
            "gpt-4o",
            "veryfront-cloud",
            call,
            stream,
            createWarningCollector(),
          ),
        }),
      },
      {
        provider: "mistral",
        build: (call, stream = false) => ({
          ...buildOpenAIChatRequest(
            "mistral-large",
            "veryfront-cloud",
            call,
            stream,
            createWarningCollector(),
          ),
        }),
      },
      {
        provider: "anthropic",
        build: (call, stream = false) => ({
          ...buildAnthropicMessagesRequest(
            "claude-haiku-4-5",
            "veryfront-cloud",
            call,
            stream,
            createWarningCollector(),
          ),
        }),
      },
      {
        provider: "google",
        build: (call) => ({
          ...buildGoogleGenerateContentRequest("veryfront-cloud", call, createWarningCollector()),
        }),
      },
    ];
    for (const testCase of cases) {
      const channels = await connected(testCase.provider, testCase.build, 32);
      try {
        for (const mode of ["generate", "stream"] as const) {
          const invoke = async (input: ModelRuntimeCallOptions) => {
            if (mode === "generate") await channels.runtime.doGenerate(input);
            else {
              const result = await channels.runtime.doStream(input);
              const reader = result.stream.getReader();
              while (!(await reader.read()).done) { /* Drain the builder fixture. */ }
              reader.releaseLock();
            }
          };
          const aliases = testCase.provider === "mistral"
            ? ["openai", "veryfront-cloud"]
            : [testCase.provider, "veryfront-cloud"];
          for (const bucket of aliases) {
            const plain = { prompt: options.prompt, maxOutputTokens: 32 };
            await invoke(plain);
            await invoke({ ...plain, providerOptions: { [bucket]: { n: 1 } } });
            assertEquals(channels.bodies.at(-1)?.n, 1);
            for (
              const field of [
                "n",
                "best_of",
                "bestOf",
                "candidateCount",
                "candidate_count",
                "num_generations",
                "numGenerations",
                "num_return_sequences",
              ]
            ) {
              const multiplied = { ...plain, providerOptions: { [bucket]: { [field]: 2 } } };
              assertEquals(testCase.build(multiplied, mode === "stream")[field], 2);
              const before = channels.bodies.length;
              const error = await assertRejects(() => invoke(multiplied), Error);
              assertEquals(parseProviderError(error).code, "RESOURCE_LIMIT_EXCEEDED");
              assertEquals(channels.bodies.length, before);
              assertEquals(channels.events.length, before);
            }
          }
        }
      } finally {
        await channels.close();
      }
    }
  });

  it("rejects Google candidate multipliers without treating response-schema properties as controls", async () => {
    const build: Builder = (call) => ({
      ...buildGoogleGenerateContentRequest("veryfront-cloud", call, createWarningCollector()),
    });
    const channels = await connected("google", build, 32);
    const schema = {
      type: "OBJECT",
      properties: {
        n: { type: "INTEGER" },
        candidateCount: { type: "INTEGER" },
        best_of: { type: "INTEGER" },
      },
    };
    try {
      for (const mode of ["generate", "stream"] as const) {
        for (const bucket of ["google", "veryfront-cloud"]) {
          const input = {
            prompt: options.prompt,
            maxOutputTokens: 32,
            providerOptions: {
              [bucket]: { generationConfig: { maxOutputTokens: 32, responseSchema: schema } },
            },
          };
          if (mode === "generate") await channels.runtime.doGenerate(input);
          else {
            const { stream } = await channels.runtime.doStream(input);
            const reader = stream.getReader();
            while (!(await reader.read()).done) { /* Drain the builder fixture. */ }
            reader.releaseLock();
          }
          assertEquals(
            (channels.bodies.at(-1)?.generationConfig as Record<string, unknown>).responseSchema,
            schema,
          );
          const multiplied = {
            ...input,
            providerOptions: {
              [bucket]: {
                generationConfig: {
                  maxOutputTokens: 32,
                  candidateCount: 2,
                  responseSchema: schema,
                },
              },
            },
          };
          assertEquals(
            (build(multiplied).generationConfig as Record<string, unknown>).candidateCount,
            2,
          );
          const error = await assertRejects(async () => {
            if (mode === "generate") await channels.runtime.doGenerate(multiplied);
            else await channels.runtime.doStream(multiplied);
          }, Error);
          assertEquals(parseProviderError(error).code, "RESOURCE_LIMIT_EXCEEDED");
        }
      }
      assertEquals(channels.bodies.length, 4);
      assertEquals(channels.events.length, 4);
    } finally {
      await channels.close();
    }
  });

  it("caps the actual Anthropic request including neutral and native reasoning", async () => {
    const build: Builder = (call) => ({
      ...buildAnthropicMessagesRequest(
        "claude-haiku-4-5",
        "veryfront-cloud",
        call,
        false,
        createWarningCollector(),
      ),
    });
    const cases: { controls: Partial<ModelRuntimeCallOptions>; budget: number; cap?: number }[] = [
      { controls: {}, budget: 0 },
      { controls: { reasoning: { enabled: true, budgetTokens: 2048 } }, budget: 2048 },
      { controls: { reasoning: { enabled: true, effort: "low" } }, budget: 1024 },
      { controls: { reasoning: { enabled: true } }, budget: 4096, cap: 8192 },
      { controls: { reasoning: { enabled: true, effort: "high" } }, budget: 16384, cap: 32768 },
      { controls: { reasoning: { enabled: true, effort: "max" } }, budget: 32768, cap: 64000 },
      {
        controls: {
          providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        },
        budget: 2048,
      },
      {
        controls: {
          reasoning: { enabled: false },
          providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        },
        budget: 2048,
      },
      {
        controls: {
          reasoning: { enabled: true, budgetTokens: 1024 },
          providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 2048 } } },
        },
        budget: 1024,
      },
      {
        controls: {
          providerOptions: {
            anthropic: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
          },
        },
        budget: 0,
      },
    ];
    for (const testCase of cases) {
      const cap = testCase.cap ?? 4096;
      const channels = await connected("anthropic", build, cap);
      try {
        for (const mode of ["generate", "stream"] as const) {
          const invoke = async (input: ModelRuntimeCallOptions) => {
            if (mode === "generate") await channels.runtime.doGenerate(input);
            else {
              const { stream } = await channels.runtime.doStream(input);
              const reader = stream.getReader();
              while (!(await reader.read()).done) { /* Consume the builder fixture stream. */ }
              reader.releaseLock();
            }
          };
          const call = { prompt: options.prompt, ...testCase.controls };
          await invoke(call);
          assertEquals(channels.calls.at(-1)?.maxOutputTokens, cap - testCase.budget);
          assertEquals(channels.events.at(-1)?.request?.maxOutputTokens, cap - testCase.budget);
          assertEquals(channels.bodies.at(-1)?.max_tokens, cap);
          if (testCase.budget) {
            assertEquals(channels.events.at(-1)?.request?.reasoning?.budgetTokens, testCase.budget);
            const before = channels.bodies.length;
            const error = await assertRejects(
              () => invoke({ ...call, maxOutputTokens: cap }),
              Error,
            );
            assertEquals(parseProviderError(error).code, "RESOURCE_LIMIT_EXCEEDED");
            assertEquals(channels.bodies.length, before);
            assertEquals(channels.events.length, before);
          }
        }
      } finally {
        await channels.close();
      }
    }
  });

  it("refuses reasoning that exhausts the grant and native aliases before dispatch", async () => {
    const channels = await connected("anthropic", (call) => ({
      ...buildAnthropicMessagesRequest(
        "claude-haiku-4-5",
        "veryfront-cloud",
        call,
        false,
        createWarningCollector(),
      ),
    }));
    try {
      for (
        const controls of [
          { reasoning: { enabled: true, budgetTokens: 4096 } },
          { reasoning: { enabled: true } },
          { reasoning: { enabled: true, effort: "high" } },
          {
            providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 4096 } } },
          },
        ] as const
      ) {
        const error = await assertRejects(
          async () => await channels.runtime.doGenerate({ prompt: [], ...controls }),
          Error,
        );
        assertEquals(parseProviderError(error).code, "RESOURCE_LIMIT_EXCEEDED");
      }
      await assertRejects(async () =>
        await channels.runtime.doGenerate({
          prompt: [],
          providerOptions: {
            "veryfront-cloud": { thinking: { type: "enabled", budget_tokens: 2048 } },
          },
        }), Error);
      assertEquals(channels.events.length, 0);
      assertEquals(channels.bodies.length, 0);
    } finally {
      await channels.close();
    }
  });
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
