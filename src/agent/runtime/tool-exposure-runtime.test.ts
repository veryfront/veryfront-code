import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas";
import { type RemoteToolSource, tool, type ToolDefinition } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { agent } from "../index.ts";
import type { AgentConfig, Message } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./tool-inventory.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function releaseTool() {
  return tool({
    id: "get_release",
    description: "Get the current release",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => ({ id: "rel-1" }),
  });
}

function toolNames(options: unknown): string[] {
  const value = (options as { tools?: unknown }).tools;
  return Array.isArray(value)
    ? value.map((tool) =>
      (tool as { name?: string; id?: string }).name ??
        (tool as { name?: string; id?: string }).id ?? ""
    ).sort()
    : Object.keys((value as Record<string, unknown> | undefined) ?? {}).sort();
}

function systemPrompt(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  return Array.isArray(prompt)
    ? prompt
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => message.content as string)
      .join("\n")
    : "";
}

function restrictedSkillMessages(input: string): Message[] {
  return [
    {
      id: "restricted-skill-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "restricted-skill-call",
        toolName: "load_skill",
        result: {
          skillId: "restricted-runtime-test",
          allowedTools: ["form_input"],
          references: [],
          scripts: [],
        },
      }],
    },
    {
      id: "restricted-user-input",
      role: "user",
      parts: [{ type: "text", text: input }],
    },
  ];
}

it("deferred generate searches, exposes on the next step, and executes once", async () => {
  const observedTools: string[][] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-tools",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "release marker" }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "marker-1",
            toolName: "read_release_marker",
            input: "{}",
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: [{ type: "text", text: "Release marker marker-1" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  let executionCount = 0;
  const assistant = agent(
    {
      id: "deferred-runtime-test",
      model: "hosted/deferred-tools",
      system: "Use tools when needed.",
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        read_release_marker: tool({
          id: "read_release_marker",
          description: "Read the release marker",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount++;
            return { marker: "marker-1" };
          },
        }),
      },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Read the release marker" });

  assertEquals(observedTools[0], ["form_input", "load_skill", "tool_search"]);
  assertEquals(observedTools[1], [
    "form_input",
    "load_skill",
    "read_release_marker",
  ]);
  assertEquals(executionCount, 1);
  assertEquals(response.text, "Release marker marker-1");
});

it("deferred generate rejects a guessed tool that was not exposed", async () => {
  let step = 0;
  let executionCount = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-guessed-tool",
    async doGenerate() {
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "guessed-1",
            toolName: "get_release",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent(
    {
      id: "deferred-guessed-generate",
      model: "hosted/deferred-guessed-tool",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        get_release: tool({
          id: "get_release",
          description: "Get the current release",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount++;
            return { id: "rel-1" };
          },
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Find the current release" });

  assertEquals(executionCount, 0);
  assertEquals(response.toolCalls[0]?.status, "error");
  assertEquals(
    response.toolCalls[0]?.error,
    'Tool "get_release" is not available in the current model step',
  );
});

it("deferred generate does not load or execute a descriptive unauthorized tool", async () => {
  const observedTools: string[][] = [];
  let modelStep = 0;
  let executionCount = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-unauthorized-description",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      modelStep++;
      if (modelStep === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-unauthorized",
            toolName: "tool_search",
            input: JSON.stringify({ query: "release marker" }),
          }],
          finishReason: "tool-calls",
        };
      }
      if (modelStep === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "call-unauthorized",
            toolName: "read_release_marker",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "blocked" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "deferred-unauthorized-description",
    model: "hosted/deferred-unauthorized-description",
    system: "Use only authorized tools.",
    tools: {
      form_input: tool({
        id: "form_input",
        description: "Collect input",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({}),
      }),
      load_skill: tool({
        id: "load_skill",
        description: "Load a skill",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({}),
      }),
      read_release_marker: tool({
        id: "read_release_marker",
        description: "Read the release marker",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => {
          executionCount++;
          return { marker: "must-not-run" };
        },
      }),
    },
    maxSteps: 3,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
  } as AgentConfig & RuntimeToolFilterConfig;

  const response = await agent(config).generate({
    input: restrictedSkillMessages("Read the release marker"),
  });

  assertEquals(observedTools[0], ["form_input", "load_skill"]);
  assertEquals(observedTools[1], ["form_input", "load_skill"]);
  assertEquals(response.toolCalls[0]?.status, "error");
  assertEquals(
    response.toolCalls[0]?.error,
    'Tool "tool_search" is not available in the current model step',
  );
  assertEquals(response.toolCalls[1]?.status, "error");
  assertEquals(
    response.toolCalls[1]?.error,
    'Tool "read_release_marker" is not available in the current model step',
  );
  assertEquals(executionCount, 0);
});

it("deferred stream rejects a guessed tool that was not exposed", async () => {
  let step = 0;
  let executionCount = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-stream-guessed-tool",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      step++;
      if (step === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "guessed-1",
              toolName: "create_release",
              input: { label: "v1.2.3" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent(
    {
      id: "deferred-stream-guessed-tool",
      model: "hosted/deferred-stream-guessed-tool",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        create_release: tool({
          id: "create_release",
          description: "Create a release",
          inputSchema: defineSchema((v) => v.object({ label: v.string() }))(),
          execute: () => {
            executionCount++;
            return { id: "rel-1" };
          },
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  await (await assistant.stream({ input: "Create release v1.2.3" }))
    .toDataStreamResponse().text();

  assertEquals(executionCount, 0);
  assertEquals(step, 2);
});

it("respond defers a tools true catalog and completes search-load-execute", async () => {
  const observedTools: string[][] = [];
  let step = 0;
  let executionCount = 0;
  const toolName = "get_release_prd_true";
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/respond-default-deferred",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: toolName },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      if (step === 2) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "release-1",
              toolName,
              input: {},
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "Release rel-1" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  toolRegistry.register(
    toolName,
    tool({
      id: toolName,
      description: "Get the current release",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        executionCount++;
        return { id: "rel-1" };
      },
    }),
  );

  try {
    const assistant = agent({
      id: "respond-tools-true-deferred",
      model: "hosted/respond-default-deferred",
      system: "Use tools when needed.",
      skills: false,
      tools: true,
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
    });

    const body = await (await assistant.respond(
      new Request("https://example.test/agent", {
        method: "POST",
        body: JSON.stringify({
          messages: [{
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Find the current release" }],
          }],
        }),
      }),
    )).text();

    assertEquals(assistant.config.tools, true);
    assertEquals(observedTools[0]?.includes(toolName), false);
    assertEquals(observedTools[0]?.includes("tool_search"), true);
    assertEquals(observedTools[1]?.includes(toolName), true);
    assertEquals(executionCount, 1);
    assertEquals(body.includes("Release rel-1"), true);
  } finally {
    toolRegistry.delete(toolName);
  }
});

it("omitted tools expose no project catalog and no tool_search", async () => {
  let observedTools: string[] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/no-project-tools",
    async doGenerate(options: unknown) {
      observedTools = toolNames(options);
      return {
        content: [{ type: "text", text: "hello" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent({
    id: "no-project-tools",
    model: "hosted/no-project-tools",
    system: "Answer directly.",
    skills: false,
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  });

  await assistant.generate({ input: "hi" });

  assertEquals(observedTools, []);
});

it("respond exposes an explicit tool map eagerly", async () => {
  let observedTools: string[] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/respond-explicit-eager",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      observedTools = toolNames(options);
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent({
    id: "respond-explicit-eager",
    model: "hosted/respond-explicit-eager",
    system: "Answer directly.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  } as AgentConfig);

  await (await assistant.respond(
    new Request("https://example.test/agent", {
      method: "POST",
      body: JSON.stringify({
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        }],
      }),
    }),
  )).text();

  assertEquals(observedTools.includes("get_release"), true);
  assertEquals(observedTools.includes("tool_search"), false);
});

it("eager generate, stream, and respond preserve a custom tool_search", async () => {
  const observedTools: string[][] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/custom-tool-search",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream(options: unknown) {
      observedTools.push(toolNames(options));
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent({
    id: "custom-tool-search",
    model: "hosted/custom-tool-search",
    system: "Use the custom search.",
    skills: false,
    tools: {
      tool_search: tool({
        id: "tool_search",
        description: "Search a custom application catalog",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: ({ query }) => ({ query }),
      }),
    },
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  });

  await assistant.generate({ input: "hi" });
  await (await assistant.stream({ input: "hi" })).toDataStreamResponse().text();
  await (await assistant.respond(
    new Request("https://example.test/agent", {
      method: "POST",
      body: JSON.stringify({
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        }],
      }),
    }),
  )).text();

  assertEquals(observedTools, [
    ["tool_search"],
    ["tool_search"],
    ["tool_search"],
  ]);
  toolRegistry.delete("tool_search");
});

it("eager generate executes a custom tool_search", async () => {
  let step = 0;
  const executionInputs: string[] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/custom-tool-search-generate",
    async doGenerate() {
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "custom-search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "releases" }),
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent({
    id: "custom-tool-search-generate",
    model: "hosted/custom-tool-search-generate",
    system: "Use the custom search.",
    skills: false,
    tools: {
      tool_search: tool({
        id: "tool_search",
        description: "Search a custom application catalog",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: ({ query }) => {
          executionInputs.push(query);
          return { query };
        },
      }),
    },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
  });

  const response = await assistant.generate({ input: "Search releases" });

  assertEquals(executionInputs, ["releases"]);
  assertEquals(response.toolCalls[0]?.status, "completed");
  toolRegistry.delete("tool_search");
});

it("eager stream executes a custom tool_search", async () => {
  let step = 0;
  const executionInputs: string[] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/custom-tool-search-stream",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      step++;
      if (step === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "custom-search-1",
              toolName: "tool_search",
              input: { query: "releases" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent({
    id: "custom-tool-search-stream",
    model: "hosted/custom-tool-search-stream",
    system: "Use the custom search.",
    skills: false,
    tools: {
      tool_search: tool({
        id: "tool_search",
        description: "Search a custom application catalog",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: ({ query }) => {
          executionInputs.push(query);
          return { query };
        },
      }),
    },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
  });

  await (await assistant.stream({ input: "Search releases" })).toDataStreamResponse().text();

  assertEquals(executionInputs, ["releases"]);
  toolRegistry.delete("tool_search");
});

it("operator eager rollback wins over host binding and request context", async () => {
  const observedTools: string[][] = [];
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/operational-tool-loading-override",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream(options: unknown) {
      observedTools.push(toolNames(options));
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent(
    {
      id: "operational-tool-loading-override",
      model: "hosted/operational-tool-loading-override",
      system: "Answer directly.",
      skills: false,
      tools: { get_release: releaseTool() },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfOperationalToolLoadingOverride: "eager",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  await assistant.generate({
    input: "hi",
    context: { __vfOperationalToolLoadingOverride: "deferred" },
  });
  await (await assistant.stream({
    input: "hi",
    context: { __vfOperationalToolLoadingOverride: "deferred" },
  })).toDataStreamResponse().text();
  await (await assistant.respond(
    new Request("https://example.test/agent", {
      method: "POST",
      body: JSON.stringify({
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        }],
        context: { __vfOperationalToolLoadingOverride: "deferred" },
      }),
    }),
  )).text();

  assertEquals(observedTools.length, 3);
  for (const tools of observedTools) {
    assertEquals(tools.includes("get_release"), true);
    assertEquals(tools.includes("tool_search"), false);
  }
});

it("provider-executed tools bypass local deferred exposure gating", async () => {
  const model: ModelRuntime = {
    provider: "anthropic",
    modelId: "claude-opus-4-6",
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
            result: { results: ["release"] },
            providerExecuted: true,
          },
        ],
        finishReason: "tool-calls",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent({
    id: "provider-executed-deferred-gate",
    model: "anthropic/claude-opus-4-6",
    system: "Search.",
    skills: false,
    providerTools: ["web_search"],
    maxSteps: 1,
    resolveModelTransport: () => ({ model }),
  });

  const response = await assistant.generate({ input: "Find a release" });

  assertEquals(response.toolCalls[0]?.status, "completed");
  assertEquals(response.toolCalls[0]?.result, { results: ["release"] });
});

it("veryfront-cloud Anthropic and OpenAI transports default to framework fallback", async () => {
  for (
    const modelId of [
      "veryfront-cloud/anthropic/claude-opus-4-6",
      "veryfront-cloud/openai/gpt-5.5",
    ]
  ) {
    let observedTools: string[] = [];
    const model: ModelRuntime = {
      provider: "veryfront-cloud",
      modelId: modelId.split("/").at(-1) ?? modelId,
      async doGenerate(options: unknown) {
        observedTools = toolNames(options);
        return { content: [{ type: "text", text: "done" }], finishReason: "stop" };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const assistant = agent(
      {
        id: `framework-fallback-${modelId.replaceAll("/", "-")}`,
        model: modelId,
        system: "Answer directly.",
        skills: false,
        tools: { get_release: releaseTool() },
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfToolLoadingMode: "deferred",
      } as AgentConfig & RuntimeToolFilterConfig,
    );

    await assistant.generate({ input: "hi" });

    assertEquals(observedTools, ["tool_search"]);
  }
});

it("deferred OpenAI searches, exposes, and executes a remote tool beyond 128 authorized tools", async () => {
  const lateToolName = "write_sandbox_files";
  const remoteTools: ToolDefinition[] = [
    ...Array.from(
      { length: 132 },
      (_, index): ToolDefinition => ({
        name: `catalog_tool_${String(index).padStart(3, "0")}`,
        description: "Catalog tool",
        parameters: { type: "object", properties: {} },
      }),
    ),
    {
      name: lateToolName,
      description: "Write sandbox files",
      parameters: { type: "object", properties: {} },
    },
  ];
  const allowedRemoteToolNames = remoteTools.map((tool) => tool.name);
  const observedTools: string[][] = [];
  let step = 0;
  let executionCount = 0;
  const remoteSource: RemoteToolSource = {
    id: "veryfront-platform-mcp",
    listTools: () => Promise.resolve(remoteTools),
    executeTool: (toolName) => {
      assertEquals(toolName, lateToolName);
      executionCount++;
      return Promise.resolve({ written: true });
    },
  };
  const model: ModelRuntime = {
    provider: "openai",
    modelId: "gpt-5.5",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: lateToolName }),
          }],
          finishReason: "tool-calls",
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "write-1",
            toolName: lateToolName,
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const assistant = agent(
    {
      id: "openai-large-deferred-catalog",
      model: "openai/gpt-5.5",
      system: "Use tools when needed.",
      skills: false,
      tools: true,
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfRemoteToolSources: [remoteSource],
      __vfAllowedRemoteTools: allowedRemoteToolNames,
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Write the sandbox files" });

  assertEquals(observedTools.every((names) => names.length <= 128), true);
  assertEquals(observedTools[0]?.includes("tool_search"), true);
  assertEquals(observedTools[0]?.includes(lateToolName), false);
  assertEquals(observedTools[1]?.includes(lateToolName), true);
  assertEquals(executionCount, 1);
  assertEquals(response.text, "done");
});

it("generate and stream budget restored exposure against an OpenAI request override", async () => {
  const remoteTools: ToolDefinition[] = Array.from(
    { length: 130 },
    (_, index): ToolDefinition => ({
      name: `catalog_tool_${String(index).padStart(3, "0")}`,
      description: "Catalog tool",
      parameters: { type: "object", properties: {} },
    }),
  );
  const allowedRemoteToolNames = remoteTools.map((tool) => tool.name);
  const observedGenerateTools: string[][] = [];
  const observedStreamTools: string[][] = [];
  const remoteSource: RemoteToolSource = {
    id: "veryfront-platform-mcp",
    listTools: () => Promise.resolve(remoteTools),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const model: ModelRuntime = {
    provider: "openai",
    modelId: "gpt-5.5",
    async doGenerate(options: unknown) {
      observedGenerateTools.push(toolNames(options));
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream(options: unknown) {
      observedStreamTools.push(toolNames(options));
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const assistant = agent(
    {
      id: "request-model-override-budget",
      model: "anthropic/claude-opus-4-6",
      system: "Use tools when needed.",
      skills: true,
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
      },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfRemoteToolSources: [remoteSource],
      __vfAllowedRemoteTools: allowedRemoteToolNames,
      __vfToolExposureCheckpoint: {
        version: 1,
        loadedToolNames: allowedRemoteToolNames,
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  await assistant.generate({ input: "hi", model: "openai/gpt-5.5" });
  await (await assistant.stream({ input: "hi", model: "openai/gpt-5.5" }))
    .toDataStreamResponse().text();

  for (const observedTools of [observedGenerateTools[0], observedStreamTools[0]]) {
    assertEquals(observedTools?.length, 128);
    assertEquals(observedTools?.includes("form_input"), true);
    assertEquals(observedTools?.includes("load_skill"), true);
    assertEquals(observedTools?.includes("tool_search"), true);
    assertEquals(observedTools?.includes("catalog_tool_129"), true);
  }
});

it("deferred search cannot spend provider capacity on an already-visible bootstrap tool", async () => {
  const remoteTools: ToolDefinition[] = Array.from(
    { length: 127 },
    (_, index): ToolDefinition => ({
      name: `catalog_tool_${String(index).padStart(3, "0")}`,
      description: "Catalog tool",
      parameters: { type: "object", properties: {} },
    }),
  );
  const allowedRemoteToolNames = remoteTools.map((tool) => tool.name);
  const observedTools: string[][] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "openai",
    modelId: "gpt-5.5",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-bootstrap",
            toolName: "tool_search",
            input: JSON.stringify({ query: "collect input" }),
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const remoteSource: RemoteToolSource = {
    id: "veryfront-platform-mcp",
    listTools: () => Promise.resolve(remoteTools),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const assistant = agent(
    {
      id: "bootstrap-search-capacity",
      model: "openai/gpt-5.5",
      system: "Use tools when needed.",
      skills: true,
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfRemoteToolSources: [remoteSource],
      __vfAllowedRemoteTools: allowedRemoteToolNames,
      __vfToolExposureCheckpoint: {
        version: 1,
        loadedToolNames: allowedRemoteToolNames.slice(0, 125),
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Collect structured input" });

  assertEquals(observedTools.length, 2);
  for (const names of observedTools) {
    assertEquals(names.length, 128);
    assertEquals(names.includes("catalog_tool_000"), true);
    assertEquals(names.includes("form_input"), true);
    assertEquals(names.includes("load_skill"), true);
    assertEquals(names.includes("tool_search"), true);
  }
  assertEquals(response.toolCalls[0]?.result, {
    matches: [{
      name: "form_input",
      description: "Collect input",
      status: "available",
    }],
    resultCount: 1,
    loadedCount: 0,
    miss: false,
    nextStep: 'The matching tool "form_input" is already available. Call it directly.',
  });
  assertEquals(response.text, "done");
});

it("deferred final-response guard frees loaded capacity before a later search", async () => {
  const catalogTools: ToolDefinition[] = Array.from(
    { length: 126 },
    (_, index): ToolDefinition => ({
      name: `catalog_tool_${String(index).padStart(3, "0")}`,
      description: "Catalog tool",
      parameters: { type: "object", properties: {} },
    }),
  );
  const remoteTools: ToolDefinition[] = [
    ...catalogTools,
    {
      name: "create_agent",
      description: "Create an agent",
      parameters: { type: "object", properties: {} },
    },
  ];
  const allowedRemoteToolNames = remoteTools.map((tool) => tool.name);
  const observedTools: string[][] = [];
  let step = 0;
  let createAgentExecutions = 0;
  const model: ModelRuntime = {
    provider: "openai",
    modelId: "gpt-5.5",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "create-agent-1",
            toolName: "create_agent",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-catalog-124",
            toolName: "tool_search",
            input: JSON.stringify({ query: "catalog_tool_124" }),
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const remoteSource: RemoteToolSource = {
    id: "veryfront-platform-mcp",
    listTools: () => Promise.resolve(remoteTools),
    executeTool: (toolName) => {
      assertEquals(toolName, "create_agent");
      createAgentExecutions++;
      return Promise.resolve({ id: "created-agent" });
    },
  };
  const assistant = agent(
    {
      id: "deferred-final-response-guard-budget",
      model: "openai/gpt-5.5",
      system: "Create the agent, then finish.",
      skills: true,
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
      },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfRemoteToolSources: [remoteSource],
      __vfAllowedRemoteTools: allowedRemoteToolNames,
      __vfToolExposureCheckpoint: {
        version: 1,
        loadedToolNames: [
          ...catalogTools.slice(0, 124).map((tool) => tool.name),
          "create_agent",
        ],
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Create an agent" });

  assertEquals(observedTools.length, 3);
  assertEquals(observedTools[0]?.includes("create_agent"), true);
  assertEquals(observedTools[2]?.length, 128);
  assertEquals(observedTools[2]?.includes("create_agent"), false);
  assertEquals(observedTools[2]?.includes("catalog_tool_000"), true);
  assertEquals(observedTools[2]?.includes("catalog_tool_124"), true);
  assertEquals(observedTools[2]?.includes("tool_search"), true);
  assertEquals(createAgentExecutions, 1);
  assertEquals(response.text, "done");
});

it(
  "framework fallback preserves configured provider tools for generate, stream, and respond",
  async () => {
    toolRegistry.register("get_release", releaseTool());
    try {
      for (
        const configuredModel of [
          "anthropic/claude-3-7-sonnet",
          "veryfront-cloud/anthropic/claude-opus-4-6",
        ]
      ) {
        const observedTools: string[][] = [];
        const observedSystems: string[] = [];
        const model: ModelRuntime = {
          provider: configuredModel.startsWith("veryfront-cloud/")
            ? "veryfront-cloud"
            : "anthropic",
          modelId: configuredModel.split("/").at(-1) ?? configuredModel,
          async doGenerate(options: unknown) {
            observedTools.push(toolNames(options));
            observedSystems.push(systemPrompt(options));
            return {
              content: [{ type: "text", text: "done" }],
              finishReason: "stop",
            };
          },
          async doStream(options: unknown) {
            observedTools.push(toolNames(options));
            observedSystems.push(systemPrompt(options));
            return {
              stream: createRuntimeStream([
                { type: "text-delta", text: "done" },
                { type: "finish", finishReason: "stop" },
              ]),
            };
          },
        };
        const assistant = agent({
          id: `fallback-provider-tools-${configuredModel.replaceAll("/", "-")}`,
          model: configuredModel,
          system: flattenSystemInstructions(
            withRuntimeToolInventory("Use configured tools.", ["tool_search", "web_search"]),
          ),
          skills: false,
          tools: true,
          providerTools: ["web_search"],
          maxSteps: 1,
          resolveModelTransport: () => ({ model }),
        });

        await assistant.generate({ input: "hi" });
        await (await assistant.stream({ input: "hi" })).toDataStreamResponse().text();
        await (await assistant.respond(
          new Request("https://example.test/agent", {
            method: "POST",
            body: JSON.stringify({
              messages: [{
                id: "user-1",
                role: "user",
                parts: [{ type: "text", text: "hi" }],
              }],
            }),
          }),
        )).text();

        assertEquals(observedTools, [
          ["form_input", "tool_search", "web_search"],
          ["form_input", "tool_search", "web_search"],
          ["form_input", "tool_search", "web_search"],
        ]);
        assertEquals(observedSystems.length, 3);
        for (const system of observedSystems) {
          assertEquals(system.includes("- web_search"), true);
          assertEquals(system.includes("- get_release"), false);
        }
      }
    } finally {
      toolRegistry.delete("get_release");
    }
  },
);

it("direct Google uses framework fallback to search, expose, and execute once", async () => {
  const observedTools: string[][] = [];
  const observedSystems: string[] = [];
  let step = 0;
  let executionCount = 0;
  const model: ModelRuntime = {
    provider: "google",
    modelId: "gemini-3.1-pro-preview",
    async doGenerate(options: unknown) {
      observedTools.push(toolNames(options));
      observedSystems.push(systemPrompt(options));
      step++;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "get_release" }),
          }],
          finishReason: "tool-calls",
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "release-1",
            toolName: "get_release",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "Release rel-1" }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  toolRegistry.register(
    "get_release",
    tool({
      id: "get_release",
      description: "Get the current release",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        executionCount++;
        return { id: "rel-1" };
      },
    }),
  );
  try {
    const assistant = agent({
      id: "google-framework-fallback",
      model: "google/gemini-3.1-pro-preview",
      system: flattenSystemInstructions(
        withRuntimeToolInventory("Use tools when needed.", ["tool_search"]),
      ),
      skills: false,
      tools: true,
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({ input: "Find the current release" });

    assertEquals(observedTools[0], ["form_input", "tool_search"]);
    assertEquals(observedTools[1], ["form_input", "get_release", "tool_search"]);
    assertEquals(observedSystems[0]?.includes("- get_release"), false);
    assertEquals(observedSystems[1]?.includes("- get_release"), true);
    assertEquals(executionCount, 1);
    assertEquals(response.text, "Release rel-1");
  } finally {
    toolRegistry.delete("get_release");
  }
});
it("deferred stream searches, exposes on the next step, and executes exact arguments once", async () => {
  const observedTools: string[][] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/deferred-stream-tools",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      if (step === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "release marker" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      if (step === 2) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "marker-1",
              toolName: "read_release_marker",
              input: {},
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "Release marker marker-1" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  let executionCount = 0;
  const assistant = agent(
    {
      id: "deferred-stream-runtime-test",
      model: "hosted/deferred-stream-tools",
      system: "Use tools when needed.",
      tools: {
        form_input: tool({
          id: "form_input",
          description: "Collect input",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        read_release_marker: tool({
          id: "read_release_marker",
          description: "Read the release marker",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount++;
            return { marker: "marker-1" };
          },
        }),
      },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const body = await (await assistant.stream({ input: "Read the release marker" }))
    .toDataStreamResponse().text();

  assertEquals(observedTools[0], ["form_input", "load_skill", "tool_search"]);
  assertEquals(observedTools[1], [
    "form_input",
    "load_skill",
    "read_release_marker",
  ]);
  assertEquals(executionCount, 1);
  assertEquals(body.includes("Release marker marker-1"), true);
});
