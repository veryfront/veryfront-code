import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
  forgetReceivedVeryfrontCloudCatalog,
  rememberReceivedVeryfrontCloudCatalog,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import { registerVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import { AgentRuntime } from "./index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import { enforceFinalRequestBudget, enforceProviderRequestBudget } from "./final-request-budget.ts";
import {
  buildModelCallContextRequest,
  resolveAdditiveReasoningOutputTokens,
} from "#veryfront/runtime/model-call-context-request.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import type { AgentConfig, Message } from "../types.ts";

describe("final model request budget", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);
  const limit = { context: 128, output: 32 };

  function servedModel(
    mode: "generate" | "stream",
    context: number,
    turns: Parameters<typeof scriptedModel>[0] = [{ text: "acknowledged" }],
    output = 32,
  ) {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: { limit: { context, output } },
      }],
    });
    const model = scriptedModel(turns, {
      modelId: "veryfront-cloud/acme/small",
      only: mode,
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    return model;
  }

  function historicalSkillReferences(): Message[] {
    const result = (id: string, toolName: string, value: unknown): Message[] => [{
      id: `call-${id}`,
      role: "assistant",
      parts: [{ type: "tool-call", toolCallId: id, toolName, args: {} }],
    }, {
      id: `result-${id}`,
      role: "tool",
      parts: [{ type: "tool-result", toolCallId: id, toolName, result: value }],
    }];
    return [
      ...result("root", "load_skill", {
        skillId: "veryfront",
        instructions: "Root skill guidance ".repeat(300).slice(0, 5_201),
        references: ["references/debug.md", "references/navigation.md"],
      }),
      ...result("debug", "load_skill", {
        skillId: "veryfront",
        file: "references/debug.md",
        content: "Debugging guidance ".repeat(140).slice(0, 2_299),
      }),
      ...result("navigation", "load_skill", {
        skillId: "veryfront",
        file: "references/navigation.md",
        content: "Capability navigation ".repeat(225).slice(0, 4_622),
      }),
      ...result("implementation", "load_skill", {
        skillId: "veryfront",
        file: "references/implementation.md",
        content: "Implementation detail ".repeat(780).slice(0, 15_800),
      }),
      ...result("page", "get_tool_result", {
        type: "tool_result_section",
        ref: "tool_result_1",
        text: "P".repeat(8_192),
        cursor: "0",
        nextCursor: "8192",
        done: false,
      }),
      { id: "user", role: "user", parts: [{ type: "text", text: "Analyze the run." }] },
    ];
  }

  function historicalResults(): import("../types.ts").Message[] {
    return [
      {
        id: "call-old",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "old", toolName: "read_data", args: {} }],
      },
      {
        id: "result-old",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "old",
          toolName: "read_data",
          result: "old value ".repeat(450),
        }],
      },
      {
        id: "call-new",
        role: "assistant",
        parts: [{ type: "tool-call", toolCallId: "new", toolName: "read_data", args: {} }],
      },
      {
        id: "result-new",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "new",
          toolName: "read_data",
          result: "latest result",
        }],
      },
      {
        id: "user-latest",
        role: "user",
        parts: [{ type: "text", text: "Use the latest result and keep the old one retrievable." }],
      },
    ];
  }

  it("counts the assembled system, messages, tool schemas and output reserve", () => {
    const input = {
      system: "System guidance ".repeat(15),
      messages: [{ role: "user", content: "User instruction ".repeat(9) }],
      tools: {
        search: {
          type: "function",
          description: "Search",
          inputSchema: { jsonSchema: { type: "object", description: "Tool schema ".repeat(10) } },
        },
      },
    };
    assertThrows(
      () => enforceFinalRequestBudget({ ...input, limit, requestedOutputTokens: 32 }),
      Error,
      "context window",
    );
    assertEquals(
      enforceFinalRequestBudget({
        ...input,
        limit: { context: 4096, output: 32 },
        requestedOutputTokens: 100,
      }).maxOutputTokens,
      32,
    );
  });

  it("rejects an explicit output request over the served output limit", () => {
    assertThrows(
      () =>
        enforceFinalRequestBudget({
          system: "ok",
          messages: [],
          limit,
          requestedOutputTokens: 33,
          explicitOutputTokens: true,
        }),
      Error,
      "output limit",
    );
  });

  it("leaves a request without served limits unchanged", () => {
    assertEquals(
      enforceFinalRequestBudget({ system: "ok", messages: [], requestedOutputTokens: 500 }),
      {
        maxOutputTokens: 500,
        estimatedInputTokens: null,
      },
    );
    assertEquals(
      enforceFinalRequestBudget({
        system: "ok",
        messages: [],
        limit: { output: 32 },
        requestedOutputTokens: 500,
      }),
      { maxOutputTokens: 32, estimatedInputTokens: null },
    );
  });

  it("counts provider-native tool id and args without its local validation schema", () => {
    const base = {
      system: "ok",
      messages: [],
      limit: { context: 4096, output: 32 },
      requestedOutputTokens: 32,
    };
    const nativeTool = {
      type: "provider",
      id: "web_search",
      args: { mode: "auto" },
      inputSchema: () => ({ jsonSchema: { description: "local only".repeat(1000) } }),
    };
    const result = enforceFinalRequestBudget({ ...base, tools: { search: nativeTool } });
    const sameWire = enforceFinalRequestBudget({
      ...base,
      tools: { search: { type: "provider", id: "web_search", args: { mode: "auto" } } },
    });
    assertEquals(result, sameWire);
  });

  it("stops an oversized actual agent generation before provider dispatch", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: { limit: { context: 256, output: 32 } },
      }],
    });
    const model = scriptedModel([{ text: "unexpected" }], {
      modelId: "veryfront-cloud/acme/small",
      only: "generate",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("small-budget-agent", {
      model: model.modelId,
      system: "Mandatory system guidance ".repeat(100),
      maxSteps: 1,
      skills: false,
      tools: {},
    }, { resolveModelRuntime: () => model });
    const error = await assertRejects(
      () => runtime.generate("Keep this user request"),
      VeryfrontError,
    );
    if (!(error instanceof VeryfrontError)) throw new Error("Expected typed context error");
    assertEquals(error.slug, "agent-context-window-exceeded");
    assertEquals(model.callCount, 0);
  });

  it("rolls back a stateful turn rejected by the budget before provider validation", async () => {
    const { registerTurnProviderRequestValidator } = await import(
      "../middleware/turn-validation.ts"
    );
    const model = servedModel("generate", 256, [{ text: "unexpected" }]);
    let validations = 0;
    const runtime = new AgentRuntime("stateful-budget-agent", {
      model: model.modelId,
      system: "Short system",
      maxSteps: 1,
      skills: false,
      tools: {},
      memory: { type: "buffer", maxMessages: 10 },
      middleware: [async (context, next) => {
        registerTurnProviderRequestValidator(context, () => {
          validations++;
          return Promise.resolve();
        });
        return await next();
      }],
    }, { resolveModelRuntime: () => model });
    await assertRejects(
      () => runtime.generate("Oversized request ".repeat(200)),
      VeryfrontError,
    );
    assertEquals(model.callCount, 0);
    assertEquals(validations, 0);
    const remembered = await runtime.getMemory().getMessages();
    assertEquals(JSON.stringify(remembered).includes("Oversized request"), false);
  });

  it("reads a managed proxy's limits from the received catalog its run scope carries", async () => {
    const key = rememberReceivedVeryfrontCloudCatalog([{
      id: "small",
      modelId: "acme/small",
      provider: "acme",
      surface: "openai",
      aliases: [],
      operations: ["chat-completions"],
      limit: { context: 256, output: 32 },
    }]);
    // A managed hosted proxy carries no registered model facts.
    const model = scriptedModel([{ text: "unexpected" }], {
      provider: "veryfront-cloud",
      modelId: "veryfront-cloud/acme/small",
      only: "generate",
    });
    const runtime = new AgentRuntime("managed-budget-agent", {
      model: model.modelId,
      system: "Mandatory system guidance ".repeat(100),
      maxSteps: 1,
      skills: false,
      tools: {},
    }, { resolveModelRuntime: () => model });
    try {
      const error = await assertRejects(
        () =>
          runWithVeryfrontCloudContextAsync(
            { catalogScopeKey: key },
            () => runtime.generate("Keep this user request"),
          ),
        VeryfrontError,
      );
      if (!(error instanceof VeryfrontError)) throw new Error("Expected typed context error");
      assertEquals(error.slug, "agent-context-window-exceeded");
      assertEquals(model.callCount, 0);
    } finally {
      forgetReceivedVeryfrontCloudCatalog(key);
    }
  });

  it("stops an oversized actual agent stream before provider dispatch", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: { limit: { context: 256, output: 32 } },
      }],
    });
    const model = scriptedModel([{ text: "unexpected" }], {
      modelId: "veryfront-cloud/acme/small",
      only: "stream",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("small-budget-stream", {
      model: model.modelId,
      system: "Mandatory system guidance ".repeat(100),
      maxSteps: 1,
      skills: false,
      tools: {},
    }, { resolveModelRuntime: () => model });
    const stream = await runtime.stream([{
      id: "user-small-budget",
      role: "user",
      parts: [{ type: "text", text: "Keep this user request" }],
    }]);
    const wire = await new Response(stream).text();
    const events = wire.split("\n").filter((line) => line.startsWith("data: ")).map((line) =>
      JSON.parse(line.slice(6)) as Record<string, unknown>
    );
    const errorIndex = events.findIndex((event) => event.type === "error");
    assert(errorIndex >= 0);
    assertEquals(events[errorIndex]?.code, "AGENT_CONTEXT_WINDOW_EXCEEDED");
    assertEquals(wire.includes("Mandatory system guidance"), false);
    assertEquals(model.callCount, 0);
  });

  it("rejects an explicit output request over the served limit in the stream", async () => {
    const model = servedModel("stream", 4096, [{ text: "unexpected" }], 32);
    const runtime = new AgentRuntime("small-output-budget-stream", {
      model: model.modelId,
      system: "Follow the request",
      maxSteps: 1,
      skills: false,
      tools: {},
    }, { resolveModelRuntime: () => model });
    const stream = await runtime.stream(
      [{
        id: "user-output-budget",
        role: "user",
        parts: [{ type: "text", text: "Keep this request" }],
      }],
      undefined,
      undefined,
      undefined,
      33,
    );
    const wire = await new Response(stream).text();
    const events = wire.split("\n").filter((line) => line.startsWith("data: ")).map((line) =>
      JSON.parse(line.slice(6)) as Record<string, unknown>
    );
    const errorIndex = events.findIndex((event) => event.type === "error");
    assert(errorIndex >= 0);
    assertEquals(events[errorIndex]?.code, "AGENT_CONTEXT_WINDOW_EXCEEDED");
    assertEquals(model.callCount, 0);
  });

  it("caps implicit output to the served deployment and keeps the user request", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: { limit: { context: 4096, output: 32 } },
      }],
    });
    const model = scriptedModel([{ text: "acknowledged" }], {
      modelId: "veryfront-cloud/acme/small",
      only: "generate",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("small-output-agent", {
      model: model.modelId,
      system: "Follow the user's request",
      maxSteps: 1,
      skills: false,
      tools: {},
    }, { resolveModelRuntime: () => model });
    await runtime.generate("Keep this precise user request");
    assertEquals(model.callCount, 1);
    assertEquals(model.calls[0]?.maxOutputTokens, 32);
    assertEquals(
      JSON.stringify(model.calls[0]?.prompt).includes("Keep this precise user request"),
      true,
    );
  });

  for (const mode of ["generate", "stream"] as const) {
    for (const override of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`treats an invalid output override ${override} as implicit and caps it (${mode})`, async () => {
        const model = servedModel(mode, 4096, [{ text: "acknowledged" }], 32);
        const runtime = new AgentRuntime("invalid-output-override", {
          model: model.modelId,
          system: "Follow the request",
          maxSteps: 1,
          skills: false,
          tools: {},
        }, { resolveModelRuntime: () => model });
        if (mode === "generate") {
          await runtime.generate("Keep this request", undefined, undefined, override);
        } else {
          const stream = await runtime.stream(
            [{
              id: "user-invalid-override",
              role: "user",
              parts: [{ type: "text", text: "Keep this request" }],
            }],
            undefined,
            undefined,
            undefined,
            override,
          );
          const wire = await new Response(stream).text();
          assertEquals(wire.includes("AGENT_CONTEXT_WINDOW_EXCEEDED"), false);
        }
        assertEquals(model.callCount, 1);
        assertEquals(model.calls[0]?.maxOutputTokens, 32);
      });
    }
  }

  it("keeps loaded schemas when eviction cannot make the request fit", async () => {
    const largeTool = tool({
      id: "large_tool",
      description: "Inspect a saved object.",
      inputSchema: defineSchema((v) =>
        v.object({
          payload: v.string().describe(`Schema guidance ${"detail ".repeat(1_200)}`),
        })
      )(),
      execute: () => ({ ok: true }),
    });
    const checkpoints: unknown[] = [];
    const model = servedModel("generate", 400, [{ text: "unexpected" }]);
    const runtime = agent(
      {
        id: "budget-eviction-rejected",
        model: model.modelId,
        system: "Answer using the latest result. ".repeat(40),
        maxSteps: 1,
        skills: false,
        tools: { large_tool: largeTool },
        toolLoading: "deferred",
        __vfToolExposureCheckpoint: { version: 2, loadedToolNames: ["large_tool"] },
        __vfToolExposureCheckpointPersistenceRequired: true,
        __vfPersistToolExposureCheckpoint: (value: unknown) => {
          checkpoints.push(value);
        },
        resolveModelTransport: () => ({ model }),
      } as AgentConfig & RuntimeToolFilterConfig,
    );
    await assertRejects(() => runtime.generate({ input: "Inspect it" }), VeryfrontError);
    assertEquals(model.callCount, 0);
    assertEquals(checkpoints, []);
  });

  for (const mode of ["generate", "stream"] as const) {
    it(`evicts an older deferred schema, checkpoints it, and allows reactivation (${mode})`, async () => {
      const makeLargeTool = () =>
        tool({
          id: "large_tool",
          description: "Inspect a saved object.",
          inputSchema: defineSchema((v) =>
            v.object({
              payload: v.string().describe(`Schema guidance ${"detail ".repeat(1_200)}`),
            })
          )(),
          execute: () => ({ ok: true }),
        });
      const history: Message[] = [
        {
          id: "old-call",
          role: "assistant",
          parts: [{ type: "tool-call", toolCallId: "old", toolName: "large_tool", args: {} }],
        },
        {
          id: "old-result",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "old",
            toolName: "large_tool",
            result: { ok: true },
          }],
        },
        {
          id: "new-call",
          role: "assistant",
          parts: [{ type: "tool-call", toolCallId: "new", toolName: "other_tool", args: {} }],
        },
        {
          id: "new-result",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "new",
            toolName: "other_tool",
            result: { latest: true },
          }],
        },
      ];
      const checkpoints: unknown[] = [];
      const model = servedModel(mode, 1_500, [() => {
        assert(checkpoints.some((entry) => JSON.stringify(entry).includes('"loadedToolNames":[]')));
        return { text: "acknowledged" };
      }]);
      const config = {
        id: `budget-eviction-${mode}`,
        model: model.modelId,
        system: "Answer using the latest result.",
        maxSteps: 1,
        skills: false,
        tools: { large_tool: makeLargeTool() },
        toolLoading: "deferred",
        __vfToolExposureCheckpoint: { version: 2, loadedToolNames: ["large_tool"] },
        __vfToolExposureCheckpointPersistenceRequired: true,
        __vfPersistToolExposureCheckpoint: (value: unknown) => {
          checkpoints.push(value);
        },
        resolveModelTransport: () => ({ model }),
      } as AgentConfig & RuntimeToolFilterConfig;
      const runtime = agent(config);
      if (mode === "generate") await runtime.generate({ input: history });
      else await (await runtime.stream({ messages: history })).toDataStreamResponse().text();
      assertEquals(model.callCount, 1);
      assertEquals(model.toolNames(0).includes("large_tool"), false);
      assertEquals(model.toolNames(0).includes("tool_search"), true);
      assert(checkpoints.some((entry) => JSON.stringify(entry).includes('"loadedToolNames":[]')));

      const resumedModel = servedModel(mode, 12_000, [
        {
          toolCalls: [{
            id: "reactivate",
            name: "tool_search",
            input: { query: "large_tool" },
          }],
        },
        { text: "Recovered the authorized schema." },
      ]);
      const resumed = agent(
        {
          ...config,
          id: `budget-resume-${mode}`,
          model: resumedModel.modelId,
          tools: { large_tool: makeLargeTool() },
          maxSteps: 2,
          __vfToolExposureCheckpoint: { version: 2, loadedToolNames: [] },
          resolveModelTransport: () => ({ model: resumedModel }),
        } as AgentConfig & RuntimeToolFilterConfig,
      );
      if (mode === "generate") await resumed.generate({ input: "Inspect the saved object" });
      else {await (await resumed.stream({ input: "Inspect the saved object" }))
          .toDataStreamResponse().text();}
      assertEquals(resumedModel.toolNames(0).includes("large_tool"), false);
      assertEquals(resumedModel.toolNames(1).includes("large_tool"), true);
    });
  }

  for (const mode of ["generate", "stream"] as const) {
    it(`projects an old ordinary result against the assembled ${mode} request`, async () => {
      const model = servedModel(mode, 1400);
      const history = historicalResults();
      const runtime = new AgentRuntime(`project-${mode}`, {
        model: model.modelId,
        system: "Keep the user's current intent and tool results.",
        maxSteps: 1,
        skills: false,
        tools: {},
        toolResultContext: { maxInlineBytes: 8192, previewBytes: 64 },
      }, { resolveModelRuntime: () => model });
      if (mode === "generate") {
        const response = await runtime.generate(history);
        assertEquals(JSON.stringify(response.messages).includes("old value ".repeat(450)), true);
      } else {
        const stream = await runtime.stream(history);
        await new Response(stream).text();
      }
      assertEquals(model.callCount, 1);
      const request = JSON.stringify(model.calls[0]);
      assert(request.includes("tool_result_reference"));
      assert(request.includes("get_tool_result"));
      assert(request.includes("latest result"));
      assert(request.includes("Use the latest result"));
      assertEquals(request.includes("old value ".repeat(450)), false);
    });

    it(`fits older skill references while retaining root guidance and the latest page (${mode})`, async () => {
      const model = servedModel(mode, 16_384, [{ text: "analyzed" }], 4_096);
      const history = historicalSkillReferences();
      const sourceBefore = JSON.stringify(history);
      const runtime = new AgentRuntime(`skill-budget-${mode}`, {
        model: model.modelId,
        system: "Mandatory system guidance ".repeat(750),
        maxSteps: 1,
        skills: false,
        tools: {},
        toolResultContext: true,
      }, { resolveModelRuntime: () => model });
      if (mode === "generate") await runtime.generate(history);
      else await new Response(await runtime.stream(history)).text();
      assertEquals(model.callCount, 1);
      assertEquals(model.calls[0]?.maxOutputTokens, 4_096);
      const request = JSON.stringify(model.calls[0]);
      assert(request.includes("Root skill guidance "));
      assert(request.includes("P".repeat(8_192)));
      assert(request.includes("tool_result_reference"));
      assertEquals(request.includes("Debugging guidance ".repeat(140).slice(0, 2_299)), false);
      assertEquals(request.includes("Capability navigation ".repeat(225).slice(0, 4_622)), false);
      assertEquals(JSON.stringify(history), sourceBefore);
    });
  }

  it("keeps an adaptive reference retrievable on the next model step", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: { limit: { context: 1400, output: 32 } },
      }],
    });
    let reference = "";
    const model = scriptedModel([
      (options) => {
        const messages = options.prompt as Array<{ role?: string; content?: unknown }>;
        const outputs = messages.filter((message) => message.role === "tool")
          .flatMap((message) => Array.isArray(message.content) ? message.content : []);
        const result = outputs.find((part) =>
          part && typeof part === "object" && "toolName" in part && part.toolName === "read_data"
        ) as { output?: { value?: { ref?: string } } } | undefined;
        reference = result?.output?.value?.ref ?? "";
        assert(reference.length > 0);
        return {
          toolCalls: [{
            id: "read-old",
            name: "get_tool_result",
            input: { ref: reference, maxBytes: 64 },
          }],
        };
      },
      (options) => {
        assert(JSON.stringify(options.prompt).includes("old value"));
        return { text: "done" };
      },
    ], { modelId: "veryfront-cloud/acme/small", only: "generate" });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("project-reader", {
      model: model.modelId,
      system: "Read referenced history when needed.",
      maxSteps: 2,
      skills: false,
      tools: {},
      toolResultContext: { maxInlineBytes: 8192, previewBytes: 64 },
    }, { resolveModelRuntime: () => model });
    await runtime.generate(historicalResults());
    assertEquals(model.callCount, 2);
  });

  it("does not adapt historical inline results without a served context limit", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "small",
        modelId: "acme/small",
        provider: "acme",
        surface: "openai",
        aliases: [],
        operations: ["chat-completions"],
        capabilities: {},
      }],
    });
    const model = scriptedModel([{ text: "acknowledged" }], {
      modelId: "veryfront-cloud/acme/small",
      only: "generate",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "acme",
      surface: "openai",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("unknown-budget", {
      model: model.modelId,
      system: "Keep the original data.",
      maxSteps: 1,
      skills: false,
      tools: {},
      toolResultContext: { maxInlineBytes: 8192, previewBytes: 64 },
    }, { resolveModelRuntime: () => model });
    await runtime.generate(historicalResults());
    const request = JSON.stringify(model.calls[0]);
    assert(request.includes("old value ".repeat(450)));
    assertEquals(request.includes("tool_result_reference"), false);
  });

  it("does not create unreadable references for a model without tool calling", async () => {
    const model = servedModel("generate", 1400);
    Object.assign(model, {
      runtimeCapabilities: { ...model.runtimeCapabilities, toolCalling: false as const },
    });
    const runtime = new AgentRuntime("no-reader-budget", {
      model: model.modelId,
      system: "Keep the original data.",
      maxSteps: 1,
      skills: false,
      tools: {},
      toolResultContext: { maxInlineBytes: 8192, previewBytes: 64 },
    }, { resolveModelRuntime: () => model });
    const error = await assertRejects(() => runtime.generate(historicalResults()), VeryfrontError);
    if (!(error instanceof VeryfrontError)) throw new Error("Expected typed context error");
    assertEquals(error.slug, "agent-context-window-exceeded");
    assertEquals(model.callCount, 0);
  });

  it("keeps tiny old results inline so one storage slot remains for a large result", async () => {
    const model = servedModel("generate", 1400);
    const history = historicalResults();
    history.splice(0, 0, {
      id: "call-tiny",
      role: "assistant",
      parts: [{ type: "tool-call", toolCallId: "tiny", toolName: "read_data", args: {} }],
    }, {
      id: "result-tiny",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "tiny",
        toolName: "read_data",
        result: "tiny fact",
      }],
    });
    const runtime = new AgentRuntime("one-useful-reference", {
      model: model.modelId,
      system: "Preserve all facts.",
      maxSteps: 1,
      skills: false,
      tools: {},
      toolResultContext: { maxInlineBytes: 8192, previewBytes: 64, maxStoredResults: 1 },
    }, { resolveModelRuntime: () => model });
    await runtime.generate(history);
    assertEquals(model.callCount, 1);
    const request = JSON.stringify(model.calls[0]);
    assert(request.includes("tiny fact"));
    assert(request.includes("tool_result_reference"));
    assertEquals(request.includes("old value ".repeat(450)), false);
  });
});

for (const type of ["image", "file"] as const) {
  it(`treats native inline ${type} token cost as unknown`, () => {
    const result = enforceFinalRequestBudget({
      system: "Describe the attachment",
      messages: [{
        role: "user",
        content: [{
          type,
          url: "data:image/png;base64," + "a".repeat(1_400_000),
          mediaType: "image/png",
        }],
      }],
      limit: { context: 128_000, output: 4096 },
      requestedOutputTokens: 4096,
    });
    assertEquals(result, { maxOutputTokens: 4096, estimatedInputTokens: null });
  });
}
it("still rejects a media request whose measurable text alone exceeds the window", () => {
  assertThrows(
    () =>
      enforceFinalRequestBudget({
        system: "Describe the attachment",
        messages: [{
          role: "user",
          content: [
            { type: "image", url: "data:image/png;base64,aaaa", mediaType: "image/png" },
            { type: "text", text: "Context ".repeat(80_000) },
          ],
        }],
        limit: { context: 128_000, output: 4096 },
        requestedOutputTokens: 4096,
      }),
    VeryfrontError,
    "at least",
  );
});
it("still rejects oversized ordinary text that contains a data URL", () => {
  assertThrows(
    () =>
      enforceFinalRequestBudget({
        system: "Help",
        messages: [{ role: "user", content: "data:image/png;base64," + "a".repeat(1_400_000) }],
        limit: { context: 128_000, output: 4096 },
        requestedOutputTokens: 4096,
      }),
    VeryfrontError,
  );
});

it("enforces the received hosted catalog limit on the real managed model proxy", async () => {
  const { createExecutorChannel } = await import("../executor/channel.ts");
  const { createExecutorModelBroker, createExecutorModelRuntimeResolver } = await import(
    "../hosted/executor-model-bridge.ts"
  );
  const { rememberReceivedVeryfrontCloudCatalog, forgetReceivedVeryfrontCloudCatalog } =
    await import("#veryfront/provider/veryfront-cloud/catalog-client.ts");
  const { runWithVeryfrontCloudContextAsync } = await import(
    "#veryfront/provider/veryfront-cloud/context.ts"
  );
  const modelId = "veryfront-cloud/acme/hosted-budget";
  const model = scriptedModel([{ text: "must not dispatch" }], {
    modelId,
    provider: "veryfront-cloud",
    only: "generate",
  });
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const binding = { allocationId: "budget", generation: 1, invocationId: "budget" };
  const caller = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations: createExecutorModelBroker({
      allowedModelIds: new Set([modelId]),
      resolveModelRuntime: () => model,
    }),
  });
  const key = rememberReceivedVeryfrontCloudCatalog([{
    id: "hosted-budget",
    modelId: "acme/hosted-budget",
    provider: "acme",
    surface: "openai",
    aliases: [],
    operations: ["chat-completions"],
    limit: { context: 128, output: 32 },
  }]);
  try {
    const resolver = await createExecutorModelRuntimeResolver({
      channel: caller,
      allowedModelIds: new Set([modelId]),
    });
    const runtime = agent({
      id: "hosted-budget",
      system: "Help",
      model: modelId,
      maxSteps: 1,
      resolveModelTransport: () => ({ model: resolver(modelId)! }),
    });
    const failure = await assertRejects(
      () =>
        runWithVeryfrontCloudContextAsync(
          { catalogScopeKey: key },
          () => runtime.generate({ input: "x".repeat(2000), maxOutputTokens: 32 }),
        ),
      VeryfrontError,
    );
    assert(failure instanceof VeryfrontError);
    assertEquals(failure.slug, "agent-context-window-exceeded");
    assertEquals(model.callCount, 0);
  } finally {
    forgetReceivedVeryfrontCloudCatalog(key);
    caller.close();
    await broker.closed;
  }
});

describe("invoke_agent child request budget", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  // Claude Haiku 4.5 serves a 200k window with a 64k output ceiling. A
  // no-tools child invoked through invoke_agent sends no output override, so
  // its requested output is the model maximum.
  async function runNoToolsChild(promptChars: number) {
    const { runAgentRuntimeForkStep } = await import("../streaming/fork-runtime-stream.ts");
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "claude-haiku-4-5",
        modelId: "anthropic/claude-haiku-4-5",
        provider: "anthropic",
        surface: "anthropic",
        aliases: [],
        operations: ["messages"],
        capabilities: { limit: { context: 200_000, output: 64_000 } },
      }],
    });
    const modelId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const model = scriptedModel([{ text: "child summary" }], {
      modelId,
      only: "stream",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "anthropic",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    // The step's response promise is observed internally and never settles
    // after a pre-dispatch rejection, so the test reads only the wire stream.
    const { stream } = await runAgentRuntimeForkStep({
      resolveModelRuntime: () => model,
      apiUrl: "http://localhost",
      authToken: "<TOKEN>",
      projectId: null,
      model: modelId,
      system: [{ role: "system", content: "Child agent guidance. ".repeat(1_000) }],
      messages: [{
        id: "child-prompt",
        role: "user",
        parts: [{ type: "text", text: "Review this section. ".repeat(promptChars / 20) }],
      }],
      forkToolNames: [],
      runtimeTools: {},
    });
    const wire = await new Response(stream).text();
    return { model, wire };
  }

  it("dispatches a typical no-tools child with the full model output", async () => {
    const { model, wire } = await runNoToolsChild(80_000);
    assertEquals(wire.includes("AGENT_CONTEXT_WINDOW_EXCEEDED"), false);
    assertEquals(model.callCount, 1);
    assertEquals(model.calls[0]?.maxOutputTokens, 64_000);
  });

  it("caps implicit output instead of rejecting a large no-tools child", async () => {
    // About 165k estimated input tokens: it fits the window, but not with the
    // full 64k model maximum reserved on top.
    const { model, wire } = await runNoToolsChild(580_000);
    assertEquals(wire.includes("AGENT_CONTEXT_WINDOW_EXCEEDED"), false);
    assertEquals(model.callCount, 1);
    const sentOutput = model.calls[0]?.maxOutputTokens ?? 0;
    const estimatedInput = 200_000 - sentOutput;
    // The estimate tracks the dispatched payload, not an inflated catalog.
    const wireTokens = JSON.stringify(model.calls[0]?.prompt).length / 4;
    assert(sentOutput >= 4_096 && sentOutput < 64_000, `sent output ${sentOutput}`);
    assert(
      estimatedInput >= wireTokens && estimatedInput <= wireTokens * 1.15,
      `estimate ${estimatedInput} for ${wireTokens} wire tokens`,
    );
  });

  it("reserves an explicit output request in full", () => {
    const input = {
      system: "ok",
      messages: [{ role: "user", content: "x".repeat(600_000) }],
      limit: { context: 200_000, output: 64_000 },
      requestedOutputTokens: 64_000,
    };
    const implicit = enforceFinalRequestBudget(input);
    assertEquals(implicit.maxOutputTokens, 200_000 - (implicit.estimatedInputTokens ?? 0));
    assertThrows(
      () => enforceFinalRequestBudget({ ...input, explicitOutputTokens: true }),
      Error,
      "plus 64000 output tokens",
    );
  });

  it("keeps a hosted grant allowance implicit and caps it to the remaining window", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "claude-haiku-4-5",
        modelId: "anthropic/claude-haiku-4-5",
        provider: "anthropic",
        surface: "anthropic",
        aliases: [],
        operations: ["messages"],
        capabilities: { limit: { context: 200_000, output: 64_000 } },
      }],
    });
    const modelId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const model = scriptedModel([{ text: "hosted reply" }], { modelId, only: "stream" });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "anthropic",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const config: AgentConfig & RuntimeToolFilterConfig = {
      model: modelId,
      system: "Hosted guidance",
      maxSteps: 1,
      skills: false,
      tools: {},
      __vfMaxOutputTokensCeiling: 48_000,
    };
    const runtime = new AgentRuntime("hosted-grant", config, { resolveModelRuntime: () => model });
    const stream = await runtime.stream([{
      id: "hosted-user",
      role: "user",
      parts: [{ type: "text", text: "Review this section. ".repeat(29_000) }],
    }]);
    const wire = await new Response(stream).text();
    assertEquals(wire.includes("AGENT_CONTEXT_WINDOW_EXCEEDED"), false);
    assertEquals(model.callCount, 1);
    const sentOutput = model.calls[0]?.maxOutputTokens ?? 0;
    assert(sentOutput >= 4_096 && sentOutput < 48_000, `sent output ${sentOutput}`);
  });

  it("reserves additive thinking tokens on top of the output request", () => {
    const input = {
      system: "ok",
      messages: [{ role: "user", content: "x".repeat(600_000) }],
      limit: { context: 200_000, output: 64_000 },
      requestedOutputTokens: 48_000,
    };
    const plain = enforceFinalRequestBudget(input);
    const thinking = enforceFinalRequestBudget({ ...input, additionalOutputTokens: 16_384 });
    assertEquals(plain.maxOutputTokens - thinking.maxOutputTokens, 16_384);
    assertEquals(
      (thinking.estimatedInputTokens ?? 0) + thinking.maxOutputTokens + 16_384,
      200_000,
    );
    assertThrows(
      () =>
        enforceFinalRequestBudget({
          ...input,
          requestedOutputTokens: 4_096,
          additionalOutputTokens: 40_000,
        }),
      Error,
      "context window",
    );
  });

  it("leaves room for an additive Anthropic thinking budget in the dispatched request", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "claude-haiku-4-5",
        modelId: "anthropic/claude-haiku-4-5",
        provider: "anthropic",
        surface: "anthropic",
        aliases: [],
        operations: ["messages"],
        capabilities: { limit: { context: 40_000, output: 64_000 } },
      }],
    });
    const modelId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const model = scriptedModel([{ text: "thought through" }], {
      modelId,
      provider: "anthropic",
      only: "generate",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "anthropic",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("thinking-budget", {
      model: modelId,
      system: "Think",
      maxSteps: 1,
      skills: false,
      tools: {},
      resolveModelTransport: () => ({
        model,
        reasoning: { enabled: true, budgetTokens: 16_384 },
      }),
    });
    await runtime.generate("Plan this ".repeat(4_000));
    assertEquals(model.callCount, 1);
    assertEquals(model.calls[0]?.reasoning?.budgetTokens, 16_384);
    const sent = model.calls[0]?.maxOutputTokens ?? 0;
    const promptTokens = JSON.stringify(model.calls[0]?.prompt).length / 4;
    assert(promptTokens + sent + 16_384 <= 40_000, `sent ${sent} for ${promptTokens}`);
  });

  it("rejects a native output override that exceeds the window on the wire", async () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "claude-haiku-4-5",
        modelId: "anthropic/claude-haiku-4-5",
        provider: "anthropic",
        surface: "anthropic",
        aliases: [],
        operations: ["messages"],
        capabilities: { limit: { context: 40_000, output: 64_000 } },
      }],
    });
    const modelId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const model = scriptedModel([{ text: "unexpected" }], {
      modelId,
      provider: "anthropic",
      only: "generate",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      catalogScopeKey: "test-scope" as ReturnType<
        typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
      >,
      provider: "anthropic",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    const runtime = new AgentRuntime("native-output", {
      model: modelId,
      system: "Answer",
      maxSteps: 1,
      skills: false,
      tools: {},
      resolveModelTransport: () => ({
        model,
        providerOptions: { anthropic: { max_tokens: 60_000 } },
      }),
    });
    const error = await assertRejects(
      () => runtime.generate("Plan this ".repeat(4_000)),
      VeryfrontError,
    );
    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "agent-context-window-exceeded");
    assertEquals(model.callCount, 0);
  });

  it("accounts for Anthropic output clamping at the actual explicit request", () => {
    const model = { provider: "anthropic", modelId: "claude-haiku-4-5" };
    const reasoning = { enabled: true, budgetTokens: 4_096 };
    for (const requestedOutputTokens of [62_000, 64_000]) {
      const input = {
        model,
        reasoning,
        system: "Plan",
        messages: [{ role: "user", content: "Think carefully." }],
        limit: { context: 200_000, output: 64_000 },
        requestedOutputTokens,
        explicitOutputTokens: true,
        additionalOutputTokens: 4_096,
      };
      const admitted = enforceProviderRequestBudget(input);
      assertEquals(admitted.maxOutputTokens, requestedOutputTokens);
      const wire = buildModelCallContextRequest(model, {
        reasoning,
        maxOutputTokens: admitted.maxOutputTokens,
      });
      assertEquals(wire?.maxOutputTokens, 64_000);
      assertThrows(() =>
        enforceProviderRequestBudget({
          ...input,
          limit: { context: 200_000, output: 63_999 },
        })
      );
    }
    const implicit = enforceProviderRequestBudget({
      model,
      reasoning,
      system: "Plan",
      messages: [],
      limit: { context: 18_000, output: 64_000 },
      requestedOutputTokens: 64_000,
    });
    const wire = buildModelCallContextRequest(model, {
      reasoning,
      maxOutputTokens: implicit.maxOutputTokens,
    });
    assert((wire?.maxOutputTokens ?? Infinity) + (implicit.estimatedInputTokens ?? 0) <= 18_000);
  });

  it("keeps additive thinking within a served output ceiling below the model maximum", () => {
    const result = enforceFinalRequestBudget({
      system: "ok",
      messages: [{ role: "user", content: "Plan" }],
      limit: { context: 200_000, output: 20_000 },
      requestedOutputTokens: 64_000,
      additionalOutputTokens: 16_384,
    });
    assertEquals(result.maxOutputTokens, 20_000 - 16_384);
    assertThrows(
      () =>
        enforceFinalRequestBudget({
          system: "ok",
          messages: [],
          limit: { context: 200_000, output: 20_000 },
          requestedOutputTokens: 8_000,
          explicitOutputTokens: true,
          additionalOutputTokens: 16_384,
        }),
      Error,
      "Requested output 24384 exceeds the served output limit 20000",
    );
  });

  it("keeps implicit output capped when only a native response format is added", () => {
    const schema = { type: "object", description: "Field guidance ".repeat(20_000) };
    const result = enforceProviderRequestBudget({
      model: { provider: "anthropic", modelId: "claude-haiku-4-5" },
      providerOptions: {
        anthropic: { output_config: { format: { type: "json_schema", schema } } },
      },
      system: "ok",
      messages: [{ role: "user", content: "x".repeat(400_000) }],
      limit: { context: 200_000, output: 64_000 },
      requestedOutputTokens: 64_000,
    });
    const withoutFormat = enforceFinalRequestBudget({
      system: "ok",
      messages: [{ role: "user", content: "x".repeat(400_000) }],
      limit: { context: 200_000, output: 64_000 },
      requestedOutputTokens: 64_000,
    });
    assert(result.maxOutputTokens < withoutFormat.maxOutputTokens);
    assert(result.maxOutputTokens >= 4_096);
  });

  it("detects additive thinking from the served Anthropic surface of a custom provider", () => {
    const model = scriptedModel([{ text: "unused" }], {
      modelId: "veryfront-cloud/acme/claude-like",
      provider: "veryfront-cloud",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      provider: "acme",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    assertEquals(
      resolveAdditiveReasoningOutputTokens(model, {
        reasoning: { enabled: true, budgetTokens: 8_192 },
      }),
      8_192,
    );
  });

  it("measures a native format that overrides the neutral schema", () => {
    const base = {
      model: { provider: "openai", modelId: "gpt-4.1", openAITransport: "chat-completions" },
      system: "ok",
      messages: [{ role: "user", content: "Answer" }],
      responseFormat: { type: "json_schema", name: "small", schema: { type: "object" } },
      limit: { context: 20_000, output: 4_096 },
      requestedOutputTokens: 4_096,
    } as const;
    enforceProviderRequestBudget(base);
    assertThrows(
      () =>
        enforceProviderRequestBudget({
          ...base,
          providerOptions: {
            openai: {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "large",
                  schema: { type: "object", description: "Field guidance ".repeat(8_000) },
                },
              },
            },
          },
        }),
      Error,
      "context window",
    );
  });

  it("applies a smaller native output limit before reserving the implicit floor", () => {
    const result = enforceProviderRequestBudget({
      model: { provider: "anthropic", modelId: "claude-haiku-4-5" },
      providerOptions: { anthropic: { max_tokens: 1_000 } },
      system: "ok",
      messages: [{ role: "user", content: "x".repeat(690_000) }],
      limit: { context: 200_000, output: 64_000 },
      requestedOutputTokens: 64_000,
    });
    assertEquals(result.maxOutputTokens, 1_000);
  });

  it("resolves a managed proxy's surface from its run scope's received catalog", async () => {
    const key = rememberReceivedVeryfrontCloudCatalog([{
      id: "claude-like",
      modelId: "acme/claude-like",
      provider: "acme",
      surface: "anthropic",
      aliases: [],
      operations: ["messages"],
    }]);
    try {
      const proxy = {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/acme/claude-like",
        modelProvider: "acme",
      };
      const tokens = await runWithVeryfrontCloudContextAsync(
        { catalogScopeKey: key },
        () =>
          Promise.resolve(resolveAdditiveReasoningOutputTokens(proxy, {
            reasoning: { enabled: true, budgetTokens: 2_048 },
          })),
      );
      assertEquals(tokens, 2_048);
    } finally {
      forgetReceivedVeryfrontCloudCatalog(key);
    }
  });

  it("reads native thinking from the dispatched provider bucket", () => {
    const model = scriptedModel([{ text: "unused" }], {
      modelId: "acme/claude-like",
      provider: "acme",
    });
    registerVeryfrontCloudModelFacts(model, () => ({
      provider: "acme",
      surface: "anthropic",
      native: true,
      transportPlan: { transport: "chat-completions", pinned: true },
    }));
    assertEquals(
      resolveAdditiveReasoningOutputTokens(model, {
        providerOptions: { acme: { thinking: { type: "enabled", budget_tokens: 2_048 } } },
      }),
      2_048,
    );
  });

  it("selects the transport a provider-native tool requires before checking native output", () => {
    const base = {
      model: { provider: "openai", modelId: "gpt-4.1", openAITransport: "auto" },
      providerOptions: { openai: { max_output_tokens: 60_000 } },
      system: "ok",
      messages: [{ role: "user", content: "Search" }],
      limit: { context: 40_000, output: 64_000 },
      requestedOutputTokens: 4_096,
    } as const;
    enforceProviderRequestBudget(base);
    assertThrows(
      () =>
        enforceProviderRequestBudget({
          ...base,
          tools: { web_search: { type: "provider", id: "openai.web_search", args: {} } },
        }),
      Error,
      "context window",
    );
  });

  it("compacts history when only the native output control exceeds the window", async () => {
    const modelId = "veryfront-cloud/anthropic/claude-haiku-4-5";
    const history = (): Message[] => [{
      id: "call-old",
      role: "assistant",
      parts: [{ type: "tool-call", toolCallId: "old", toolName: "read_data", args: {} }],
    }, {
      id: "result-old",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "old",
        toolName: "read_data",
        result: "old value ".repeat(6_000),
      }],
    }, {
      id: "user-next",
      role: "user",
      parts: [{ type: "text", text: "Summarize briefly" }],
    }];
    const run = async (context: number) => {
      __setVeryfrontCloudCatalogForTests({
        models: [{
          id: "claude-haiku-4-5",
          modelId: "anthropic/claude-haiku-4-5",
          provider: "anthropic",
          surface: "anthropic",
          aliases: [],
          operations: ["messages"],
          capabilities: { limit: { context, output: 64_000 } },
        }],
      });
      const model = scriptedModel([{ text: "summary" }], {
        modelId,
        provider: "anthropic",
        only: "generate",
      });
      registerVeryfrontCloudModelFacts(model, () => ({
        catalogScopeKey: "test-scope" as ReturnType<
          typeof import("#veryfront/provider/veryfront-cloud/catalog-client.ts").veryfrontCloudCatalogScopeKey
        >,
        provider: "anthropic",
        surface: "anthropic",
        native: true,
        transportPlan: { transport: "chat-completions", pinned: true },
      }));
      const runtime = new AgentRuntime("native-compaction", {
        model: modelId,
        system: "Answer",
        maxSteps: 1,
        skills: false,
        tools: {},
        toolResultContext: { maxInlineBytes: 1_000_000, previewBytes: 64 },
        resolveModelTransport: () => ({
          model,
          providerOptions: { anthropic: { max_tokens: 20_000 } },
        }),
      });
      await runtime.generate(history());
      return model;
    };
    const roomy = await run(1_000_000);
    assertEquals(JSON.stringify(roomy.calls[0]?.prompt).includes("tool_result_reference"), false);
    const fullInput = Math.ceil(JSON.stringify(roomy.calls[0]?.prompt).length / 4 * 1.1);
    const tight = await run(fullInput + 10_000);
    assertEquals(tight.callCount, 1);
    assert(JSON.stringify(tight.calls[0]?.prompt).includes("tool_result_reference"));
  });

  it("still rejects a child whose input leaves less than the bounded output reserve", async () => {
    const { model, wire } = await runNoToolsChild(700_000);
    assertEquals(wire.includes("AGENT_CONTEXT_WINDOW_EXCEEDED"), true);
    assertEquals(model.callCount, 0);
  });
});
