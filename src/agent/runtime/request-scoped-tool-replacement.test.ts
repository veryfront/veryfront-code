import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { agent } from "../index.ts";

function toolNamesFromGenerateOptions(options: unknown): string[] {
  const tools = (options as { tools?: Record<string, unknown> | Array<{ name?: string }> })
    .tools;
  if (Array.isArray(tools)) {
    return tools.map((entry) => entry.name ?? "").filter(Boolean).sort();
  }
  return Object.keys(tools ?? {}).sort();
}

function lastUserText(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  if (!Array.isArray(prompt)) return "";
  for (let i = prompt.length - 1; i >= 0; i--) {
    const entry = prompt[i];
    if (entry?.role !== "user") continue;
    const content = entry.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : ""
        )
        .join("");
    }
  }
  return "";
}

function makeLookupTool(source: string) {
  return tool({
    id: "lookup",
    description: `Lookup from ${source}`,
    inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
    execute: async ({ query }) => ({ source, query }),
  });
}

describe("request-scoped tool replacement for generate()", () => {
  it("advertises only the request replacement tools and lets same-name replacements win", async () => {
    toolRegistry.clearAll();
    const controller = new AbortController();
    const observedToolNames: string[][] = [];
    let observedAbortSignal: AbortSignal | undefined;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/request-tools-advertise",
      async doGenerate(options: unknown) {
        observedAbortSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
        observedToolNames.push(toolNamesFromGenerateOptions(options));
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    toolRegistry.register(
      "registry_only",
      tool({
        id: "registry_only",
        description: "Registry-only tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ source: "registry" }),
      }),
    );

    const assistant = agent({
      model: "hosted/request-tools-advertise",
      system: "Use tools.",
      tools: {
        lookup: makeLookupTool("configured"),
        registry_only: true,
      },
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({
      input: "Which tools are available?",
      abortSignal: controller.signal,
      tools: {
        lookup: makeLookupTool("replacement"),
      },
    });

    assertEquals(observedToolNames, [["lookup"]]);
    assertEquals(observedAbortSignal, controller.signal);
    toolRegistry.clearAll();
  });

  it("does not fall through to configured, registry, remote, integration, or provider-native tools", async () => {
    toolRegistry.clearAll();
    const observedToolNames: string[][] = [];
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate(options: unknown) {
        observedToolNames.push(toolNamesFromGenerateOptions(options));
        return {
          content: [{
            type: "tool-call",
            toolCallId: "configured-1",
            toolName: "configured_only",
            input: "{}",
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    toolRegistry.register(
      "registry_only",
      tool({
        id: "registry_only",
        description: "Registry-only tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ source: "registry" }),
      }),
    );

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use tools.",
      maxSteps: 1,
      providerTools: ["web_search"],
      tools: {
        configured_only: tool({
          id: "configured_only",
          description: "Configured-only tool",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => ({ source: "configured" }),
        }),
        registry_only: true,
      },
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: "Call the configured tool",
      tools: {},
    });

    assertEquals(observedToolNames, [[]]);
    assertEquals(result.toolCalls[0]?.status, "error");
    assertEquals(
      result.toolCalls[0]?.error,
      'Tool "configured_only" is not available in request-scoped replacement tools',
    );
    toolRegistry.clearAll();
  });

  it("does not accept provider-executed tool results outside the replacement map", async () => {
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "web-search-1",
              toolName: "web_search",
              input: "{}",
            },
            {
              type: "tool-result",
              toolCallId: "web-search-1",
              toolName: "web_search",
              result: { results: ["provider result"] },
              providerExecuted: true,
            },
          ],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider tools.",
      maxSteps: 1,
      providerTools: ["web_search"],
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: "Search the web",
      tools: {},
    });

    assertEquals(result.toolCalls[0]?.status, "error");
    assertEquals(
      result.toolCalls[0]?.error,
      'Tool "web_search" is not available in request-scoped replacement tools',
    );
  });

  it("does not persist provider-executed tool results when no paired tool call is returned", async () => {
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [
            { type: "text", text: "I searched." },
            {
              type: "tool-result",
              toolCallId: "web-search-unpaired",
              toolName: "web_search",
              result: { results: ["provider result"] },
              providerExecuted: true,
            },
          ],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use provider tools.",
      providerTools: ["web_search"],
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: "Search the web",
      tools: {},
    });

    assertEquals(result.toolCalls[0]?.status, "error");
    assertEquals(
      result.toolCalls[0]?.error,
      'Tool "web_search" is not available in request-scoped replacement tools',
    );
    assertEquals(
      result.messages.some((message) =>
        message.role === "tool" &&
        message.parts.some((part) =>
          part.type === "tool-result" &&
          JSON.stringify((part as { result?: unknown }).result).includes("provider result")
        )
      ),
      false,
    );
  });

  it("rejects unpaired provider-executed tool results even when the replacement tool name matches", async () => {
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [
            { type: "text", text: "I searched." },
            {
              type: "tool-result",
              toolCallId: "web-search-unpaired",
              toolName: "web_search",
              result: { results: ["provider result"] },
              providerExecuted: true,
            },
          ],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Use replacement tools.",
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: "Search the web",
      tools: {
        web_search: tool({
          id: "web_search",
          description: "Mock web search.",
          inputSchema: defineSchema((v) => v.object({ query: v.string().optional() }))(),
          execute: async ({ query }) => ({ results: [query ?? "mock result"] }),
        }),
      },
    });

    assertEquals(result.toolCalls[0]?.status, "error");
    assertEquals(
      result.toolCalls[0]?.error,
      'Tool "web_search" is not available in request-scoped replacement tools',
    );
    assertEquals(
      result.messages.some((message) =>
        message.role === "tool" &&
        message.parts.some((part) =>
          part.type === "tool-result" &&
          JSON.stringify((part as { result?: unknown }).result).includes("provider result")
        )
      ),
      false,
    );
  });

  it("keeps concurrent generate() replacement maps isolated on one agent", async () => {
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/request-tools-concurrent",
      async doGenerate(options: unknown) {
        if (toolNamesFromGenerateOptions(options).includes("lookup")) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: `lookup-${lastUserText(options)}`,
              toolName: "lookup",
              input: `{"query":"${lastUserText(options)}"}`,
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    const assistant = agent({
      model: "hosted/request-tools-concurrent",
      system: "Use lookup.",
      maxSteps: 2,
      tools: {
        lookup: makeLookupTool("configured"),
      },
      resolveModelTransport: async () => ({ model }),
    });

    const [left, right] = await Promise.all([
      assistant.generate({
        input: "left",
        tools: { lookup: makeLookupTool("left") },
      }),
      assistant.generate({
        input: "right",
        tools: { lookup: makeLookupTool("right") },
      }),
    ]);

    assertEquals(left.toolCalls[0]?.result, { source: "left", query: "left" });
    assertEquals(right.toolCalls[0]?.result, { source: "right", query: "right" });
  });

  it("keeps existing configured-tool behavior when no replacement is provided", async () => {
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/request-tools-existing-behavior",
      async doGenerate() {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "lookup-existing",
            toolName: "lookup",
            input: '{"query":"current"}',
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };

    const assistant = agent({
      model: "hosted/request-tools-existing-behavior",
      system: "Use lookup.",
      maxSteps: 1,
      tools: {
        lookup: makeLookupTool("configured"),
      },
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({ input: "lookup" });

    assertEquals(result.toolCalls[0]?.status, "completed");
    assertEquals(result.toolCalls[0]?.result, { source: "configured", query: "current" });
  });
});
