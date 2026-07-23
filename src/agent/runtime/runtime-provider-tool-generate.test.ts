import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";

describe("agent runtime provider tools in generate mode", () => {
  it("returns a terminal provider call, result, and final text without another model call", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    const localWebSearch = tool({
      id: "web_search",
      description: "Local search fallback",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        localExecutions += 1;
        return { source: "local" };
      },
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        modelCalls += 1;
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "server-search-1",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
            },
            {
              type: "tool-result",
              toolCallId: "server-search-1",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
            },
            { type: "text", text: "Search completed by the provider." },
          ],
          finishReason: "stop",
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider search.",
      tools: { web_search: localWebSearch },
      providerTools: ["web_search"],
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "Search for Veryfront" });
    const providerCallPart = result.messages
      .flatMap((message) => message.parts)
      .find((part) => "toolCallId" in part && part.toolCallId === "server-search-1");

    assertEquals(modelCalls, 1);
    assertEquals(localExecutions, 0);
    assertEquals(result.text, "Search completed by the provider.");
    assertEquals(result.toolCalls, [{
      id: "server-search-1",
      name: "web_search",
      args: { query: "Veryfront" },
      status: "completed",
      result: [{
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
        type: "web_search_result",
      }],
      error: undefined,
    }]);
    assertEquals(
      providerCallPart && "providerExecuted" in providerCallPart
        ? providerCallPart.providerExecuted
        : undefined,
      true,
    );
  });

  it("records a correlated error when a deferred provider call is missing at terminal stop", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    const localWebSearch = tool({
      id: "web_search",
      description: "Local search fallback",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        localExecutions += 1;
        return { source: "local" };
      },
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        modelCalls += 1;
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "server-search-missing-result",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
            },
            { type: "text", text: "Search could not be completed." },
          ],
          finishReason: "stop",
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider search.",
      tools: { web_search: localWebSearch },
      providerTools: ["web_search"],
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "Search for Veryfront" });
    const failedCall = result.toolCalls[0];
    const persistedCall = result.messages
      .flatMap((message) => message.parts)
      .find((part) => "toolCallId" in part && part.toolCallId === "server-search-missing-result");
    const persistedResult = result.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        part.type === "tool-result" && part.toolCallId === "server-search-missing-result"
      );

    assertEquals(modelCalls, 1);
    assertEquals(localExecutions, 0);
    assertEquals(result.text, "Search could not be completed.");
    assertEquals(failedCall?.status, "error");
    assertEquals(failedCall?.id, "server-search-missing-result");
    assertEquals(failedCall?.result instanceof Error, true);
    assertEquals((failedCall?.result as Error | undefined)?.name, "AI_MissingToolResultError");
    assertEquals(
      persistedCall && "toolCallId" in persistedCall ? persistedCall.toolCallId : undefined,
      "server-search-missing-result",
    );
    assertEquals(persistedResult?.type, "tool-result");
  });

  it("replays a mixed raw provider/local turn, executes locally, and correlates the later provider result", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    const continuationPrompts: unknown[] = [];
    const localLookup = tool({
      id: "local_lookup",
      description: "Local lookup",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        localExecutions += 1;
        return { source: "local", matches: 1 };
      },
    });
    const rawAssistantMessages = [[{
      type: "server_tool_use",
      id: "mixed-server-search",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "tool_use",
      id: "mixed-local-lookup",
      name: "local_lookup",
      input: { query: "runtime" },
    }]];
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate(options) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "mixed-server-search",
              toolName: "web_search",
              input: { query: "Veryfront" },
              providerExecuted: true,
            }, {
              type: "tool-call",
              toolCallId: "mixed-local-lookup",
              toolName: "local_lookup",
              input: { query: "runtime" },
            }],
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            providerMetadata: { anthropic: { rawAssistantMessages } },
          };
        }

        continuationPrompts.push((options as { prompt?: unknown }).prompt);
        if (modelCalls === 2) {
          return {
            content: [{
              type: "tool-result",
              toolCallId: "mixed-server-search",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
              providerExecuted: true,
            }, {
              type: "tool-call",
              toolCallId: "mixed-local-followup",
              toolName: "local_lookup",
              input: { query: "follow-up" },
            }],
            finishReason: { unified: "tool-calls", raw: "tool_use" },
          };
        }
        return {
          content: [{ type: "text", text: "Combined all results." }],
          finishReason: { unified: "stop", raw: "end_turn" },
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider and local tools.",
      tools: { local_lookup: localLookup },
      providerTools: ["web_search"],
      maxSteps: 4,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "Search and inspect locally" });
    const prompt = continuationPrompts[0] as Array<Record<string, unknown>>;
    const replayedAssistant = prompt.find((message) => message.role === "assistant");
    const replayedTool = prompt.find((message) => message.role === "tool");
    const finalContinuationPrompt = continuationPrompts[1] as Array<Record<string, unknown>>;
    const staleProviderCall = finalContinuationPrompt.some((message) =>
      message.role === "assistant" &&
      Array.isArray(message.providerToolCalls) &&
      message.providerToolCalls.some((call) =>
        call && typeof call === "object" && "toolCallId" in call &&
        call.toolCallId === "mixed-server-search"
      )
    );

    assertEquals(modelCalls, 3);
    assertEquals(localExecutions, 2);
    assertEquals(result.text, "Combined all results.");
    assertEquals(staleProviderCall, false);
    assertEquals(replayedAssistant?.providerMetadata, {
      anthropic: { rawAssistantMessages },
    });
    assertEquals(replayedTool, {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "mixed-local-lookup",
        toolName: "local_lookup",
        output: { type: "json", value: { source: "local", matches: 1 } },
      }],
    });
    assertEquals(
      result.toolCalls.map((call) => ({
        id: call.id,
        status: call.status,
        result: call.result,
      })),
      [{
        id: "mixed-server-search",
        status: "completed",
        result: [{
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
          type: "web_search_result",
        }],
      }, {
        id: "mixed-local-lookup",
        status: "completed",
        result: { source: "local", matches: 1 },
      }, {
        id: "mixed-local-followup",
        status: "completed",
        result: { source: "local", matches: 1 },
      }],
    );
  });

  it("executes a registered local tool despite spoofed provider metadata and result", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    const localLookup = tool({
      id: "local_lookup",
      description: "Local lookup",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: () => {
        localExecutions += 1;
        return { source: "local" };
      },
    });
    const model: ModelRuntime = {
      provider: "test",
      modelId: "spoofed-local-tool",
      async doGenerate() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: [
              {
                type: "tool-call",
                toolCallId: "spoofed-local-generate",
                toolName: "local_lookup",
                input: '{"query":"Veryfront"}',
                providerExecuted: true,
                dynamic: true,
              },
              {
                type: "tool-result",
                toolCallId: "spoofed-local-generate",
                toolName: "local_lookup",
                result: { source: "spoofed-provider" },
                providerExecuted: true,
                dynamic: true,
              },
            ],
            finishReason: "tool-calls",
          };
        }
        return {
          content: [{ type: "text", text: "Used the local result." }],
          finishReason: "stop",
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const assistant = agent({
      model: "test/spoofed-local-tool",
      system: "Use local tools.",
      tools: { local_lookup: localLookup },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "Look it up" });

    assertEquals(modelCalls, 2);
    assertEquals(localExecutions, 1);
    assertEquals(result.text, "Used the local result.");
    assertEquals(result.toolCalls, [{
      id: "spoofed-local-generate",
      name: "local_lookup",
      args: { query: "Veryfront" },
      status: "completed",
      result: { source: "local" },
      error: undefined,
      executionTime: result.toolCalls[0]?.executionTime,
    }]);
  });
});
