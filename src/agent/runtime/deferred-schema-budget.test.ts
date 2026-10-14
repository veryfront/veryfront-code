import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ToolDefinition } from "#veryfront/tool";
import type { Message } from "../types.ts";
import { fitDeferredToolSchemasToBudget } from "./deferred-schema-budget.ts";
import { inspectFinalRequestBudget } from "./final-request-budget.ts";
import { createToolExposurePlan, createToolExposureState } from "./tool-exposure.ts";

function definition(name: string, size = 1): ToolDefinition {
  return {
    name,
    description: `Read ${name}`,
    parameters: {
      type: "object",
      properties: { payload: { type: "string", description: "x".repeat(size) } },
    },
  };
}

function toolTurn(name: string, id: string): Message[] {
  return [{
    id: `${id}-call`,
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: id, toolName: name, args: {} }],
  }, {
    id: `${id}-result`,
    role: "tool",
    parts: [{ type: "tool-result", toolCallId: id, toolName: name, result: { ok: true } }],
  }];
}

it("evicts an older loaded schema only when the assembled request needs room", () => {
  const state = createToolExposureState(["create_agent"]);
  const plan = createToolExposurePlan({
    authorized: [
      definition("load_skill"),
      definition("create_agent", 6_000),
      definition("get_agent_source"),
    ],
    mode: "deferred",
    state,
    bootstrapToolNames: new Set(["load_skill", "get_agent_source"]),
  });
  const messages = [...toolTurn("create_agent", "create"), ...toolTurn("get_agent_source", "read")];
  const inspect = (candidate: typeof plan) =>
    inspectFinalRequestBudget({
      system: "s".repeat(39_000),
      messages,
      tools: Object.fromEntries(candidate.visible.map((tool) => [tool.name, {
        description: tool.description,
        inputSchema: { jsonSchema: tool.parameters },
      }])),
      limit: { context: 16_384, output: 4_096 },
      requestedOutputTokens: 4_096,
    });
  assertEquals(inspect(plan).fits, false);
  const fitted = fitDeferredToolSchemasToBudget({ plan, sourceMessages: messages, inspect });
  assertEquals(inspect(fitted.plan).fits, true);
  assertEquals(fitted.evictedNames, ["create_agent"]);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "create_agent"), false);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "tool_search"), true);
  assertEquals(fitted.plan.deferred.some((tool) => tool.name === "create_agent"), true);
  assertEquals(plan.visible.some((tool) => tool.name === "create_agent"), true);
  assertEquals([...state.loadedToolNames], ["create_agent"]);
});

it("keeps a just-used schema and a newly activated schema awaiting its first call", () => {
  const state = createToolExposureState(["create_agent"]);
  const plan = createToolExposurePlan({
    authorized: [definition("load_skill"), definition("create_agent", 6_000)],
    mode: "deferred",
    state,
    bootstrapToolNames: new Set(["load_skill"]),
  });
  const inspect = (candidate: typeof plan) => ({
    fits: !candidate.visible.some((tool) => tool.name === "create_agent"),
    outputExceeded: false,
    estimatedInputTokens: candidate.visible.some((tool) => tool.name === "create_agent")
      ? 13_250
      : 11_500,
  });
  const justUsed = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: toolTurn("create_agent", "create"),
    inspect,
  });
  assertEquals(justUsed.evictedNames, []);
  const justLoaded = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: toolTurn("tool_search", "load"),
    inspect,
  });
  assertEquals(justLoaded.evictedNames, []);
});

it("protects every schema returned by the most recent search batch", () => {
  const state = createToolExposureState(["older", "first", "second"]);
  const plan = createToolExposurePlan({
    authorized: [
      definition("older", 6_000),
      definition("first", 6_000),
      definition("second", 6_000),
    ],
    mode: "deferred",
    state,
  });
  const sourceMessages: Message[] = [
    ...toolTurn("older", "old"),
    {
      id: "search-call",
      role: "assistant",
      parts: [{ type: "tool-call", toolCallId: "search", toolName: "tool_search", args: {} }],
    },
    {
      id: "search-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "search",
        toolName: "tool_search",
        result: {
          matches: [
            { name: "first", status: "loaded", description: "First" },
            { name: "second", status: "loaded", description: "Second" },
          ],
          resultCount: 2,
          loadedCount: 2,
          miss: false,
        },
      }],
    },
  ];
  const fitted = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages,
    inspect: (candidate) => ({
      fits: candidate.visible.every((tool) => tool.name !== "older"),
      outputExceeded: false,
      estimatedInputTokens: candidate.visible.some((tool) => tool.name === "older")
        ? 13_250
        : 11_500,
    }),
  });
  assertEquals(fitted.evictedNames, ["older"]);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "first"), true);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "second"), true);

  const afterOneUse = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: [
      ...sourceMessages,
      ...toolTurn("first", "first-use"),
      ...toolTurn("other", "later-use"),
    ],
    inspect: (candidate) => {
      const old = candidate.visible.some((tool) => tool.name === "older");
      const first = candidate.visible.some((tool) => tool.name === "first");
      return {
        fits: !old && !first,
        outputExceeded: false,
        estimatedInputTokens: 11_500 + Number(old) * 1_000 + Number(first) * 750,
      };
    },
  });
  assertEquals(afterOneUse.evictedNames, ["older", "first"]);
  assertEquals(afterOneUse.plan.visible.some((tool) => tool.name === "second"), true);
});

function searchTurn(id: string, loaded: readonly string[]): Message[] {
  return [{
    id: `${id}-call`,
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: id, toolName: "tool_search", args: {} }],
  }, {
    id: `${id}-result`,
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: id,
      toolName: "tool_search",
      result: {
        matches: loaded.map((name) => ({ name, status: "loaded", description: name })),
        resultCount: loaded.length,
        loadedCount: loaded.length,
        miss: false,
      },
    }],
  }];
}

it("stops protecting turn-local schemas once a newer user message ends the tool turn", () => {
  const state = createToolExposureState(["searched", "called"]);
  const plan = createToolExposurePlan({
    authorized: [definition("searched", 6_000), definition("called", 6_000)],
    mode: "deferred",
    state,
  });
  const inspect = (candidate: typeof plan) => {
    const remaining =
      candidate.visible.filter((tool) => tool.name === "searched" || tool.name === "called").length;
    return {
      fits: remaining === 0,
      outputExceeded: false,
      estimatedInputTokens: 10_000 + remaining * 1_500,
    };
  };
  const endOfTurn = (id: string): Message[] => [{
    id: `${id}-answer`,
    role: "assistant",
    parts: [{ type: "text", text: "Done." }],
  }, {
    id: `${id}-user`,
    role: "user",
    parts: [{ type: "text", text: "Thanks, something else now." }],
  }];
  const searched = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: [...searchTurn("search", ["searched"]), ...endOfTurn("a")],
    inspect,
  });
  assertEquals(searched.evictedNames.includes("searched"), true);
  const called = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: [...toolTurn("called", "call"), ...endOfTurn("b")],
    inspect,
  });
  assertEquals(called.evictedNames.includes("called"), true);
});

it("stops protecting a searched schema once a newer search step supersedes it", () => {
  const state = createToolExposureState(["stale", "fresh"]);
  const plan = createToolExposurePlan({
    authorized: [definition("stale", 6_000), definition("fresh", 6_000)],
    mode: "deferred",
    state,
  });
  const fitted = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: [
      ...searchTurn("first-search", ["stale"]),
      ...searchTurn("next-search", ["fresh"]),
    ],
    inspect: (candidate) => {
      const stale = candidate.visible.some((tool) => tool.name === "stale");
      return {
        fits: !stale,
        outputExceeded: false,
        estimatedInputTokens: stale ? 13_250 : 11_500,
      };
    },
  });
  assertEquals(fitted.evictedNames, ["stale"]);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "fresh"), true);
});

it("evicts an unused schema from an older search batch while protecting the latest batch", () => {
  const state = createToolExposureState(["old", "latest"]);
  const plan = createToolExposurePlan({
    authorized: [definition("old", 6000), definition("latest", 6000)],
    mode: "deferred",
    state,
  });
  const search = (
    id: string,
    name: string,
  ): Message[] => [{
    id: id + "-call",
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: id, toolName: "tool_search", args: {} }],
  }, {
    id: id + "-result",
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: id,
      toolName: "tool_search",
      result: { matches: [{ name, status: "loaded" }] },
    }],
  }];
  const fitted = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: [...search("first", "old"), ...search("second", "latest")],
    inspect: (candidate) => ({
      fits: !candidate.visible.some((tool) => tool.name === "old"),
      outputExceeded: false,
      estimatedInputTokens: candidate.visible.some((tool) => tool.name === "old") ? 15000 : 10000,
    }),
  });
  assertEquals(fitted.evictedNames, ["old"]);
  assertEquals(fitted.plan.visible.some((tool) => tool.name === "latest"), true);
});

it("protects schemas from parallel searches in the same new model decision", () => {
  const state = createToolExposureState(["first", "second"]);
  const plan = createToolExposurePlan({
    authorized: [definition("first", 6000), definition("second", 6000)],
    mode: "deferred",
    state,
  });
  const messages: Message[] = [
    {
      id: "parallel",
      role: "assistant",
      parts: ["first", "second"].map((name) => ({
        type: "tool-call",
        toolCallId: name,
        toolName: "tool_search",
        args: {},
      })),
    },
    ...["first", "second"].map((name): Message => ({
      id: name,
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: name,
        toolName: "tool_search",
        result: { matches: [{ name, status: "loaded" }] },
      }],
    })),
  ];
  const fitted = fitDeferredToolSchemasToBudget({
    plan,
    sourceMessages: messages,
    inspect: (candidate) => ({
      fits: false,
      outputExceeded: false,
      estimatedInputTokens: candidate.visible.length * 1000,
    }),
  });
  assertEquals(fitted.evictedNames, []);
});

it("does not protect a stale schema after a search that loaded nothing", () => {
  const state = createToolExposureState(["create_agent"]);
  const plan = createToolExposurePlan({
    authorized: [definition("load_skill"), definition("create_agent", 6_000)],
    mode: "deferred",
    state,
    bootstrapToolNames: new Set(["load_skill"]),
  });
  const inspect = (candidate: typeof plan) => ({
    fits: !candidate.visible.some((tool) => tool.name === "create_agent"),
    outputExceeded: false,
    estimatedInputTokens: candidate.visible.some((tool) => tool.name === "create_agent")
      ? 13_250
      : 11_500,
  });
  const searchMiss: Message[] = [{
    id: "miss-call",
    role: "assistant",
    parts: [{ type: "tool-call", toolCallId: "miss", toolName: "tool_search", args: {} }],
  }, {
    id: "miss-result",
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: "miss",
      toolName: "tool_search",
      result: { matches: [] },
    }],
  }];
  const fitted = fitDeferredToolSchemasToBudget({ plan, sourceMessages: searchMiss, inspect });
  assertEquals(fitted.evictedNames, ["create_agent"]);
});

it("amortizes the tool_search schema across several small schema evictions", () => {
  const state = createToolExposureState(["small_a", "small_b"]);
  const plan = createToolExposurePlan({
    authorized: [definition("load_skill"), definition("small_a", 1), definition("small_b", 1)],
    mode: "deferred",
    state,
    bootstrapToolNames: new Set(["load_skill"]),
  });
  const searchCost = 100;
  // Each eviction saves 70 tokens; tool_search costs 100 once.
  const inspect = (candidate: typeof plan) => {
    const estimate = 1_000 -
      70 *
        ["small_a", "small_b"].filter((name) =>
          !candidate.visible.some((tool) => tool.name === name)
        ).length +
      (candidate.visible.some((tool) => tool.name === "tool_search") ? searchCost : 0);
    return { fits: estimate <= 970, outputExceeded: false, estimatedInputTokens: estimate };
  };
  const fitted = fitDeferredToolSchemasToBudget({ plan, sourceMessages: [], inspect });
  assertEquals(fitted.evictedNames, ["small_a", "small_b"]);
  assertEquals(inspect(fitted.plan).fits, true);
});

it("amortizes the search schema over multiple deferred evictions", () => {
  for (const count of [1, 2]) {
    const names = ["first", "second"].slice(0, count);
    const state = createToolExposureState(names);
    const plan = createToolExposurePlan({
      authorized: names.map((name) => definition(name)),
      mode: "deferred",
      state,
    });
    const inspect = (candidate: typeof plan) => {
      const removed = count - candidate.loadedToolNames.size;
      const helper = candidate.visible.some((tool) => tool.name === "tool_search");
      const estimate = 2_000 - removed * 400 + (helper ? 600 : 0);
      return { fits: estimate <= 1_900, outputExceeded: false, estimatedInputTokens: estimate };
    };
    const fitted = fitDeferredToolSchemasToBudget({ plan, sourceMessages: [], inspect });
    assertEquals(inspect(fitted.plan).fits, count === 2);
    assertEquals(fitted.evictedNames, count === 2 ? names : []);
    assertEquals([...state.loadedToolNames], names);
  }
});
