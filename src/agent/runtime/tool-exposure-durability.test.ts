import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import type { ToolExposureCheckpoint } from "./tool-exposure.ts";

function releaseTool(onExecute: () => void = () => {}) {
  return tool({
    id: "get_release",
    description: "Get the current release",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => {
      onExecute();
      return { id: "rel-1" };
    },
  });
}

function listProjectsTool() {
  return tool({
    id: "list_projects",
    description: "List projects",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => [],
  });
}

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function toolNames(options: unknown): string[] {
  const value = (options as { tools?: unknown }).tools;
  return Array.isArray(value)
    ? value.map((entry) =>
      (entry as { name?: string; id?: string }).name ??
        (entry as { name?: string; id?: string }).id ?? ""
    )
    : Object.keys((value as Record<string, unknown> | undefined) ?? {});
}

it("generate awaits checkpoint persistence before the next model step and target execution", async () => {
  const callOrder: string[] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/generate-durability-order",
    async doGenerate() {
      step++;
      if (step === 1) {
        callOrder.push("tool_search");
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
        callOrder.push("next_model_step");
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
      return { content: [{ type: "text", text: "done" }], finishReason: "stop" };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "generate-durability-order",
    model: "hosted/generate-durability-order",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool(() => callOrder.push("target_tool")) },
    maxSteps: 3,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfToolExposureCheckpointPersistenceRequired: true,
    __vfPersistToolExposureCheckpoint: async () => {
      callOrder.push("persist_checkpoint:start");
      await Promise.resolve();
      callOrder.push("persist_checkpoint:done");
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  await agent(config).generate({ input: "Find the release" });

  assertEquals(callOrder, [
    "tool_search",
    "persist_checkpoint:start",
    "persist_checkpoint:done",
    "next_model_step",
    "target_tool",
  ]);
});

it("stream awaits checkpoint persistence before the next model step", async () => {
  const callOrder: string[] = [];
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/stream-durability-order",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      step++;
      if (step === 1) {
        callOrder.push("tool_search");
        return {
          stream: createRuntimeStream([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "get_release" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      }
      callOrder.push("next_model_step");
      return {
        stream: createRuntimeStream([
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ]),
      };
    },
  };
  const config = {
    id: "stream-durability-order",
    model: "hosted/stream-durability-order",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfToolExposureCheckpointPersistenceRequired: true,
    __vfPersistToolExposureCheckpoint: async () => {
      callOrder.push("persist_checkpoint:start");
      await Promise.resolve();
      callOrder.push("persist_checkpoint:done");
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  await (await agent(config).stream({ input: "Find the release" })).toDataStreamResponse().text();

  assertEquals(callOrder, [
    "tool_search",
    "persist_checkpoint:start",
    "persist_checkpoint:done",
    "next_model_step",
  ]);
});

it("a new runtime restores a persisted checkpoint and calls the target without another search", async () => {
  let checkpoint: ToolExposureCheckpoint | undefined;
  let firstStep = 0;
  const firstModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/checkpoint-first-invocation",
    async doGenerate() {
      firstStep++;
      return firstStep === 1
        ? {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "get_release" }),
          }],
          finishReason: "tool-calls",
        }
        : { content: [{ type: "text", text: "pause" }], finishReason: "stop" };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const baseConfig = {
    model: "hosted/checkpoint-first-invocation",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    __vfToolLoadingMode: "deferred",
  } satisfies Partial<AgentConfig & RuntimeToolFilterConfig>;
  await agent(
    {
      ...baseConfig,
      id: "checkpoint-first-invocation",
      resolveModelTransport: () => ({ model: firstModel }),
      __vfToolExposureCheckpointPersistenceRequired: true,
      __vfPersistToolExposureCheckpoint: (value: ToolExposureCheckpoint) => {
        checkpoint = value;
      },
    } as AgentConfig & RuntimeToolFilterConfig,
  ).generate({ input: "Find the release" });

  let targetExecutions = 0;
  let resumedStep = 0;
  const resumedModel: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/checkpoint-second-invocation",
    async doGenerate(options: unknown) {
      resumedStep++;
      const names = toolNames(options);
      if (resumedStep === 1) {
        assertEquals(names.includes("get_release"), true);
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
      return { content: [{ type: "text", text: "done" }], finishReason: "stop" };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const response = await agent(
    {
      ...baseConfig,
      id: "checkpoint-second-invocation",
      model: "hosted/checkpoint-second-invocation",
      tools: { get_release: releaseTool(() => targetExecutions++) },
      resolveModelTransport: () => ({ model: resumedModel }),
      __vfToolExposureCheckpoint: checkpoint,
    } as AgentConfig & RuntimeToolFilterConfig,
  ).generate({ input: "Continue" });

  assertEquals(targetExecutions, 1);
  assertEquals(response.toolCalls.some((call) => call.name === "tool_search"), false);
});

it("restores the invocation checkpoint only on step zero", async () => {
  let step = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/checkpoint-step-zero",
    async doGenerate(options: unknown) {
      step++;
      if (step === 1) {
        assertEquals(toolNames(options).includes("get_release"), true);
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "list_projects" }),
          }],
          finishReason: "tool-calls",
        };
      }
      assertEquals(toolNames(options).includes("get_release"), true);
      assertEquals(toolNames(options).includes("list_projects"), true);
      return { content: [{ type: "text", text: "done" }], finishReason: "stop" };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "checkpoint-step-zero",
    model: "hosted/checkpoint-step-zero",
    system: "Use tools.",
    skills: false,
    tools: {
      get_release: releaseTool(),
      list_projects: listProjectsTool(),
    },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfToolExposureCheckpoint: {
      version: 1,
      authorizedCatalogFingerprint: "v1-previous",
      loadedToolNames: ["get_release"],
    },
  } as AgentConfig & RuntimeToolFilterConfig;

  await agent(config).generate({ input: "Continue" });
});

it("required durable checkpoint persistence fails closed when the callback is absent", async () => {
  let modelCalls = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/missing-checkpoint-persister",
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
        : { content: [{ type: "text", text: "must not run" }], finishReason: "stop" };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "missing-checkpoint-persister",
    model: "hosted/missing-checkpoint-persister",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool() },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfToolExposureCheckpointPersistenceRequired: true,
  } as AgentConfig & RuntimeToolFilterConfig;

  await assertRejects(
    () => agent(config).generate({ input: "Find the release" }),
    Error,
    "checkpoint persistence is required",
  );
  assertEquals(modelCalls, 1);
});

it("checkpoint persistence rejection aborts before continuation and target execution", async () => {
  let modelCalls = 0;
  let targetExecutions = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/rejected-checkpoint-persister",
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
          content: [{
            type: "tool-call",
            toolCallId: "release-1",
            toolName: "get_release",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const config = {
    id: "rejected-checkpoint-persister",
    model: "hosted/rejected-checkpoint-persister",
    system: "Use tools.",
    skills: false,
    tools: { get_release: releaseTool(() => targetExecutions++) },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
    __vfToolLoadingMode: "deferred",
    __vfToolExposureCheckpointPersistenceRequired: true,
    __vfPersistToolExposureCheckpoint: () => Promise.reject(new Error("checkpoint rejected")),
  } as AgentConfig & RuntimeToolFilterConfig;

  await assertRejects(
    () => agent(config).generate({ input: "Find the release" }),
    Error,
    "checkpoint rejected",
  );
  assertEquals(modelCalls, 1);
  assertEquals(targetExecutions, 0);
});
