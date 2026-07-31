import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { agent } from "../index.ts";
import type { AgentConfig, Message } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import type { ToolExposureCheckpoint } from "./tool-exposure.ts";
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

it("respond exposes an explicit tool map eagerly and ignores a removed loading-policy field", async () => {
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
    toolLoading: "deferred",
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

  assertEquals(Object.hasOwn(assistant.config, "toolLoading"), false);
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

it("generate flushes and restores a deferred tool checkpoint without another search", async () => {
  let checkpoint: ToolExposureCheckpoint | undefined;
  let checkpointFlushed = false;
  let firstRunStep = 0;
  const firstRunModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/generate-checkpoint",
    async doGenerate() {
      firstRunStep++;
      if (firstRunStep === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "get_release" }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      assertEquals(checkpointFlushed, true);
      return {
        content: [{ type: "text", text: "interrupted" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const firstRunConfig = {
    id: "generate-checkpoint-first",
    model: "hosted/generate-checkpoint",
    system: "Use tools when needed.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model: firstRunModel }),
    __vfToolLoadingMode: "deferred",
    __vfPersistToolExposureCheckpoint: async (nextCheckpoint: ToolExposureCheckpoint) => {
      await Promise.resolve();
      checkpoint = nextCheckpoint;
      checkpointFlushed = true;
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  await agent(firstRunConfig).generate({ input: "Find the current release" });

  const resumedTools: string[][] = [];
  let resumedRequest = "";
  let resumedCalls = 0;
  const resumedModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/generate-checkpoint",
    async doGenerate(options: unknown) {
      resumedCalls++;
      resumedTools.push(toolNames(options));
      resumedRequest = JSON.stringify(options);
      return {
        content: [{ type: "text", text: "resumed" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const resumedConfig = {
    ...firstRunConfig,
    id: "generate-checkpoint-resumed",
    resolveModelTransport: () => ({ model: resumedModel }),
    __vfToolExposureCheckpoint: checkpoint,
    __vfPersistToolExposureCheckpoint: undefined,
  } as AgentConfig & RuntimeToolFilterConfig;

  await agent(resumedConfig).generate({ input: "Continue" });

  assertEquals(resumedCalls, 1);
  assertEquals(resumedTools[0]?.includes("get_release"), true);
  assertEquals(resumedTools[0]?.includes("tool_search"), false);
  assertEquals(resumedRequest.includes("authorizedCatalogFingerprint"), false);
  assertEquals(resumedRequest.includes("loadedToolNames"), false);
});

it("stream flushes and restores a deferred tool checkpoint without another search", async () => {
  let checkpoint: ToolExposureCheckpoint | undefined;
  let checkpointFlushed = false;
  let firstRunStep = 0;
  const firstRunModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/stream-checkpoint",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      firstRunStep++;
      if (firstRunStep === 1) {
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "get_release" },
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      }
      assertEquals(checkpointFlushed, true);
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "interrupted" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]),
      };
    },
  };
  const firstRunConfig = {
    id: "stream-checkpoint-first",
    model: "hosted/stream-checkpoint",
    system: "Use tools when needed.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model: firstRunModel }),
    __vfToolLoadingMode: "deferred",
    __vfPersistToolExposureCheckpoint: async (nextCheckpoint: ToolExposureCheckpoint) => {
      await Promise.resolve();
      checkpoint = nextCheckpoint;
      checkpointFlushed = true;
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  const firstRunBody = await (await agent(firstRunConfig).stream({
    input: "Find the current release",
  })).toDataStreamResponse().text();

  const resumedTools: string[][] = [];
  let resumedCalls = 0;
  const resumedModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/stream-checkpoint",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      resumedCalls++;
      resumedTools.push(toolNames(options));
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "resumed" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]),
      };
    },
  };
  const resumedConfig = {
    ...firstRunConfig,
    id: "stream-checkpoint-resumed",
    resolveModelTransport: () => ({ model: resumedModel }),
    __vfToolExposureCheckpoint: checkpoint,
    __vfPersistToolExposureCheckpoint: undefined,
  } as AgentConfig & RuntimeToolFilterConfig;

  await (await agent(resumedConfig).stream({ input: "Continue" }))
    .toDataStreamResponse().text();

  assertEquals(resumedCalls, 1);
  assertEquals(resumedTools[0]?.includes("get_release"), true);
  assertEquals(resumedTools[0]?.includes("tool_search"), false);
  assertEquals(firstRunBody.includes("AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT"), false);
  assertEquals(firstRunBody.includes("authorizedCatalogFingerprint"), false);
});

it("generate aborts before the next model step when checkpoint persistence fails", async () => {
  let modelCalls = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/checkpoint-failure",
    async doGenerate() {
      modelCalls++;
      return modelCalls === 1
        ? {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "get_release" }),
          }],
          finishReason: "tool-calls",
        }
        : {
          content: [{ type: "text", text: "must not run" }],
          finishReason: "stop",
        };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "generate-checkpoint-failure",
    model: "hosted/checkpoint-failure",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfPersistToolExposureCheckpoint: () => {
      throw new Error("checkpoint write failed");
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  await assertRejects(
    () => agent(config).generate({ input: "Find a release" }),
    Error,
    "checkpoint write failed",
  );
  assertEquals(modelCalls, 1);
});

it("stream aborts before the next model step when checkpoint persistence fails", async () => {
  let modelCalls = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/checkpoint-stream-failure",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      modelCalls++;
      return {
        stream: modelCalls === 1
          ? createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "get_release" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ])
          : createRuntimeStream([
            { type: "text-delta", text: "must not run" },
            { type: "finish", finishReason: "stop" },
          ]),
      };
    },
  };
  const config = {
    id: "stream-checkpoint-failure",
    model: "hosted/checkpoint-stream-failure",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfPersistToolExposureCheckpoint: () => {
      throw new Error("checkpoint stream write failed");
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  const body = await (await agent(config).stream({ input: "Find a release" }))
    .toDataStreamResponse().text();

  assertEquals(modelCalls, 1);
  assertEquals(body.includes("checkpoint stream write failed"), true);
});

it("generate drops revoked checkpoint tools after the authorized catalog changes", async () => {
  let checkpoint: ToolExposureCheckpoint | undefined;
  let firstRunStep = 0;
  const firstRunModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/revoked-checkpoint",
    async doGenerate() {
      firstRunStep++;
      return firstRunStep === 1
        ? {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "get_release" }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }
        : {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  await agent(
    {
      id: "revoked-checkpoint-first",
      model: "hosted/revoked-checkpoint",
      system: "Use tools when needed.",
      skills: false,
      tools: { get_release: releaseTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: firstRunModel }),
      __vfToolLoadingMode: "deferred",
      __vfPersistToolExposureCheckpoint: (nextCheckpoint: ToolExposureCheckpoint) => {
        checkpoint = nextCheckpoint;
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  ).generate({ input: "Find a release" });

  let resumedTools: string[] = [];
  const resumedModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/revoked-checkpoint",
    async doGenerate(options: unknown) {
      resumedTools = toolNames(options);
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
  await agent(
    {
      id: "revoked-checkpoint-resumed",
      model: "hosted/revoked-checkpoint",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        get_status: tool({
          id: "get_status",
          description: "Get status",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
      },
      maxSteps: 1,
      resolveModelTransport: () => ({ model: resumedModel }),
      __vfToolLoadingMode: "deferred",
      __vfToolExposureCheckpoint: checkpoint,
    } as AgentConfig & RuntimeToolFilterConfig,
  ).generate({ input: "Continue" });

  assertEquals(resumedTools.includes("get_release"), false);
  assertEquals(resumedTools.includes("get_status"), false);
  assertEquals(resumedTools.includes("tool_search"), true);
});

it("stream resume drops revoked checkpoint tools after the authorized catalog changes", async () => {
  let checkpoint: ToolExposureCheckpoint | undefined;
  let firstRunStep = 0;
  const firstRunModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/revoked-stream-checkpoint",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      firstRunStep++;
      return {
        stream: firstRunStep === 1
          ? createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "get_release" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ])
          : createRuntimeStream([
            { type: "text-delta", text: "interrupted" },
            { type: "finish", finishReason: "stop" },
          ]),
      };
    },
  };
  await (await agent(
    {
      id: "revoked-stream-checkpoint-first",
      model: "hosted/revoked-stream-checkpoint",
      system: "Use tools when needed.",
      skills: false,
      tools: { get_release: releaseTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model: firstRunModel }),
      __vfToolLoadingMode: "deferred",
      __vfPersistToolExposureCheckpoint: (nextCheckpoint: ToolExposureCheckpoint) => {
        checkpoint = nextCheckpoint;
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  ).stream({ input: "Find a release" })).toDataStreamResponse().text();

  let resumedTools: string[] = [];
  const resumedModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/revoked-stream-checkpoint",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      resumedTools = toolNames(options);
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  await (await agent(
    {
      id: "revoked-stream-checkpoint-resumed",
      model: "hosted/revoked-stream-checkpoint",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        get_status: tool({
          id: "get_status",
          description: "Get status",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
      },
      maxSteps: 1,
      resolveModelTransport: () => ({ model: resumedModel }),
      __vfToolLoadingMode: "deferred",
      __vfToolExposureCheckpoint: checkpoint,
    } as AgentConfig & RuntimeToolFilterConfig,
  ).stream({ input: "Continue" })).toDataStreamResponse().text();

  assertEquals(resumedTools.includes("get_release"), false);
  assertEquals(resumedTools.includes("get_status"), false);
  assertEquals(resumedTools.includes("tool_search"), true);
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
