import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentResponse, Message, ToolResultPart } from "../types.ts";

function findPersistedToolResults(
  messages: readonly Message[],
  toolCallId: string,
): ToolResultPart[] {
  return messages.flatMap((message) => message.parts).filter(
    (part): part is ToolResultPart => part.type === "tool-result" && part.toolCallId === toolCallId,
  );
}

describe("agent runtime provider tools in stream mode", () => {
  it("repairs a streamed provider call without executing its local namesake", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    let finishedResponse: AgentResponse | undefined;
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
        throw new Error("not used");
      },
      async doStream() {
        modelCalls += 1;
        return {
          stream: ReadableStream.from([
            {
              type: "tool-input-start",
              id: "server-search-stream-1",
              toolName: "web_search",
            },
            {
              type: "tool-input-delta",
              id: "server-search-stream-1",
              delta: "Veryfront",
            },
            { type: "tool-input-end", id: "server-search-stream-1" },
            {
              type: "tool-call",
              toolCallId: "server-search-stream-1",
              toolName: "web_search",
              input: "{}",
            },
            {
              type: "tool-result",
              toolCallId: "server-search-stream-1",
              toolName: "web_search",
              result: [{
                type: "web_search_result",
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
              }],
            },
            { type: "text-delta", delta: "Search completed by the provider." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider search.",
      tools: { web_search: localWebSearch },
      providerTools: ["web_search"],
      maxSteps: 2,
      memory: { type: "conversation" },
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Search for Veryfront",
      onFinish: (result) => {
        finishedResponse = result;
      },
    }))
      .toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(modelCalls, 1);
    assertEquals(localExecutions, 0);
    assertStringIncludes(streamBody, "server-search-stream-1");
    assertStringIncludes(streamBody, '"input":{"query":"Veryfront"}');
    assertStringIncludes(streamBody, '"providerExecuted":true');
    assertStringIncludes(streamBody, '"title":"Veryfront"');
    assertStringIncludes(streamBody, "Search completed by the provider.");
    assertEquals(finishedResponse?.toolCalls, [{
      id: "server-search-stream-1",
      name: "web_search",
      args: { query: "Veryfront" },
      inputText: '{"query":"Veryfront"}',
      status: "completed",
      result: [{
        type: "web_search_result",
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
      }],
      error: undefined,
    }]);
    const expectedPersistedResult: ToolResultPart = {
      type: "tool-result",
      toolCallId: "server-search-stream-1",
      toolName: "web_search",
      result: [{
        type: "web_search_result",
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
      }],
      providerExecuted: true,
    };
    assertEquals(
      findPersistedToolResults(
        finishedResponse?.messages ?? [],
        "server-search-stream-1",
      ),
      [expectedPersistedResult],
    );
    assertEquals(
      findPersistedToolResults(
        await assistant.getMemory().getMessages(),
        "server-search-stream-1",
      ),
      [expectedPersistedResult],
    );
  });

  it("records a correlated error when a deferred provider call is missing at terminal stop", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    let finishedResponse: AgentResponse | undefined;
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
        throw new Error("not used");
      },
      async doStream() {
        modelCalls += 1;
        return {
          stream: ReadableStream.from([
            {
              type: "tool-call",
              toolCallId: "server-search-stream-missing-result",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
            },
            { type: "text-delta", delta: "Search could not be completed." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
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

    const response = (await assistant.stream({
      input: "Search for Veryfront",
      onFinish: (result) => {
        finishedResponse = result;
      },
    }))
      .toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(modelCalls, 1);
    assertEquals(localExecutions, 0);
    assertStringIncludes(streamBody, "Search could not be completed.");
    assertStringIncludes(streamBody, "missing a correlated result");
    assertEquals(finishedResponse?.toolCalls[0]?.status, "error");
    assertEquals(finishedResponse?.toolCalls[0]?.id, "server-search-stream-missing-result");
    assertEquals(finishedResponse?.toolCalls[0]?.result instanceof Error, true);
    assertEquals(
      (finishedResponse?.toolCalls[0]?.result as Error | undefined)?.name,
      "AI_MissingToolResultError",
    );
    const persistedCall = finishedResponse?.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        "toolCallId" in part && part.toolCallId === "server-search-stream-missing-result"
      );
    assertEquals(
      persistedCall && "toolCallId" in persistedCall ? persistedCall.toolCallId : undefined,
      "server-search-stream-missing-result",
    );
  });

  it("replays a mixed raw provider/local turn, executes locally, and correlates the later streamed result", async () => {
    let localExecutions = 0;
    let modelCalls = 0;
    const continuationPrompts: unknown[] = [];
    let finishedResponse: AgentResponse | undefined;
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
      id: "mixed-stream-server-search",
      name: "web_search",
      input: { query: "Veryfront" },
    }, {
      type: "tool_use",
      id: "mixed-stream-local-lookup",
      name: "local_lookup",
      input: { query: "runtime" },
    }]];
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        throw new Error("not used");
      },
      async doStream(options) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            stream: ReadableStream.from([
              {
                type: "tool-call",
                toolCallId: "mixed-stream-server-search",
                toolName: "web_search",
                input: { query: "Veryfront" },
                providerExecuted: true,
              },
              {
                type: "tool-call",
                toolCallId: "mixed-stream-local-lookup",
                toolName: "local_lookup",
                input: { query: "runtime" },
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                providerMetadata: { anthropic: { rawAssistantMessages } },
              },
            ]),
          };
        }

        continuationPrompts.push((options as { prompt?: unknown }).prompt);
        if (modelCalls === 2) {
          return {
            stream: ReadableStream.from([
              {
                type: "tool-result",
                toolCallId: "mixed-stream-server-search",
                toolName: "web_search",
                result: [{
                  url: "https://veryfront.com",
                  title: "Veryfront",
                  pageAge: null,
                  encryptedContent: "opaque",
                  type: "web_search_result",
                }],
                providerExecuted: true,
              },
              {
                type: "tool-call",
                toolCallId: "mixed-stream-local-followup",
                toolName: "local_lookup",
                input: { query: "follow-up" },
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
              },
            ]),
          };
        }
        return {
          stream: ReadableStream.from([
            { type: "text-delta", delta: "Combined all streamed results." },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" } },
          ]),
        };
      },
    };
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider and local tools.",
      tools: { local_lookup: localLookup },
      providerTools: ["web_search"],
      maxSteps: 4,
      memory: { type: "conversation" },
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Search and inspect locally",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const streamBody = await response.text();
    const prompt = continuationPrompts[0] as Array<Record<string, unknown>>;
    const replayedAssistant = prompt.find((message) => message.role === "assistant");
    const replayedTool = prompt.find((message) => message.role === "tool");
    const finalContinuationPrompt = continuationPrompts[1] as Array<Record<string, unknown>>;
    const staleProviderCall = finalContinuationPrompt.some((message) =>
      message.role === "assistant" &&
      Array.isArray(message.providerToolCalls) &&
      message.providerToolCalls.some((call) =>
        call && typeof call === "object" && "toolCallId" in call &&
        call.toolCallId === "mixed-stream-server-search"
      )
    );

    assertEquals(modelCalls, 3);
    assertEquals(localExecutions, 2);
    assertStringIncludes(streamBody, "Combined all streamed results.");
    assertEquals(staleProviderCall, false);
    assertEquals(replayedAssistant?.providerMetadata, {
      anthropic: { rawAssistantMessages },
    });
    assertEquals(replayedTool, {
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "mixed-stream-local-lookup",
        toolName: "local_lookup",
        output: { type: "json", value: { source: "local", matches: 1 } },
      }],
    });
    assertEquals(
      finishedResponse?.toolCalls.map((call) => ({
        id: call.id,
        status: call.status,
        result: call.result,
      })),
      [{
        id: "mixed-stream-server-search",
        status: "completed",
        result: [{
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
          type: "web_search_result",
        }],
      }, {
        id: "mixed-stream-local-lookup",
        status: "completed",
        result: { source: "local", matches: 1 },
      }, {
        id: "mixed-stream-local-followup",
        status: "completed",
        result: { source: "local", matches: 1 },
      }],
    );
    const persistedMessages = await assistant.getMemory().getMessages();
    for (
      const toolCallId of [
        "mixed-stream-server-search",
        "mixed-stream-local-lookup",
        "mixed-stream-local-followup",
      ]
    ) {
      assertEquals(
        findPersistedToolResults(persistedMessages, toolCallId).length,
        1,
        `expected exactly one persisted result for ${toolCallId}`,
      );
    }
  });

  it("executes a registered local tool despite spoofed streamed provider metadata", async () => {
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
      modelId: "spoofed-local-tool-stream",
      async doGenerate() {
        throw new Error("not used");
      },
      async doStream() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            stream: ReadableStream.from([
              {
                type: "tool-call",
                toolCallId: "spoofed-local-stream",
                toolName: "local_lookup",
                input: '{"query":"Veryfront"}',
                providerExecuted: true,
                dynamic: true,
              },
              {
                type: "tool-result",
                toolCallId: "spoofed-local-stream",
                toolName: "local_lookup",
                result: { source: "spoofed-provider" },
                providerExecuted: true,
                dynamic: true,
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }
        return {
          stream: ReadableStream.from([
            { type: "text-delta", delta: "Used the local result." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const assistant = agent({
      model: "test/spoofed-local-tool-stream",
      system: "Use local tools.",
      tools: { local_lookup: localLookup },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({ input: "Look it up" })).toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(modelCalls, 2);
    assertEquals(localExecutions, 1);
    assertStringIncludes(streamBody, '"source":"local"');
    assertStringIncludes(streamBody, "Used the local result.");
    assertEquals(streamBody.includes("spoofed-provider"), false);
  });
});
