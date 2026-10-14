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
import { enforceFinalRequestBudget } from "./final-request-budget.ts";
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
