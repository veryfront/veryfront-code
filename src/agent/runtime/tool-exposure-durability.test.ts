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

type RuntimeMode = "generate" | "stream";

async function runRuntime(
  mode: RuntimeMode,
  config: AgentConfig & RuntimeToolFilterConfig,
  input = "Find the release",
) {
  const assistant = agent(config);
  if (mode === "generate") return await assistant.generate({ input });
  return await (await assistant.stream({ input })).toDataStreamResponse().text();
}

function checkpoint(...loadedToolNames: string[]): ToolExposureCheckpoint {
  return { version: 1, loadedToolNames };
}

for (const mode of ["generate", "stream"] as const) {
  it(`${mode} awaits checkpoint persistence before the next model step`, async () => {
    const callOrder: string[] = [];
    let step = 0;
    const nextStep = () => {
      step++;
      if (step === 1) {
        callOrder.push("tool_search");
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: mode === "generate"
              ? JSON.stringify({ query: "get_release" })
              : { query: "get_release" },
          }],
          finishReason: "tool-calls",
        };
      }
      if (step === 2) {
        callOrder.push("next_model_step");
        return mode === "generate"
          ? {
            content: [{
              type: "tool-call",
              toolCallId: "release-1",
              toolName: "get_release",
              input: "{}",
            }],
            finishReason: "tool-calls",
          }
          : { content: [{ type: "text-delta", text: "done" }], finishReason: "stop" };
      }
      return { content: [{ type: "text", text: "done" }], finishReason: "stop" };
    };
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: `hosted/${mode}-durability-order`,
      async doGenerate() {
        return nextStep();
      },
      async doStream() {
        const result = nextStep();
        return {
          stream: createRuntimeStream([
            ...result.content,
            { type: "finish", finishReason: result.finishReason },
          ]),
        };
      },
    };
    const config = {
      id: `${mode}-durability-order`,
      model: `hosted/${mode}-durability-order`,
      system: "Use tools.",
      skills: false,
      tools: { get_release: releaseTool(() => callOrder.push("target_tool")) },
      maxSteps: mode === "generate" ? 3 : 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfToolExposureCheckpointPersistenceRequired: true,
      __vfPersistToolExposureCheckpoint: async () => {
        callOrder.push("persist_checkpoint:start");
        await Promise.resolve();
        callOrder.push("persist_checkpoint:done");
      },
    } as AgentConfig & RuntimeToolFilterConfig;

    await runRuntime(mode, config);

    assertEquals(callOrder, [
      "tool_search",
      "persist_checkpoint:start",
      "persist_checkpoint:done",
      "next_model_step",
      ...(mode === "generate" ? ["target_tool"] : []),
    ]);
  });
}

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

it("stream exposes a restored tool on step zero without another search", async () => {
  const observedTools: string[][] = [];
  let step = 0;
  let targetExecutions = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/stream-restored-checkpoint",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream(options: unknown) {
      observedTools.push(toolNames(options));
      step++;
      return {
        stream: createRuntimeStream(
          step === 1
            ? [
              {
                type: "tool-call",
                toolCallId: "release-1",
                toolName: "get_release",
                input: {},
              },
              { type: "finish", finishReason: "tool-calls" },
            ]
            : [
              { type: "text-delta", text: "done" },
              { type: "finish", finishReason: "stop" },
            ],
        ),
      };
    },
  };

  await runRuntime(
    "stream",
    {
      id: "stream-restored-checkpoint",
      model: "hosted/stream-restored-checkpoint",
      system: "Use tools.",
      skills: false,
      tools: { get_release: releaseTool(() => targetExecutions++) },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfToolExposureCheckpoint: checkpoint("get_release"),
    } as AgentConfig & RuntimeToolFilterConfig,
    "Continue",
  );

  assertEquals(observedTools[0], ["get_release"]);
  assertEquals(targetExecutions, 1);
});

for (const mode of ["generate", "stream"] as const) {
  it(`${mode} drops restored tools removed from the authorized catalog`, async () => {
    let observedTools: string[] = [];
    const observe = (options: unknown) => {
      observedTools = toolNames(options);
      return { finishReason: "stop" as const };
    };
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: `hosted/${mode}-revoked-checkpoint`,
      async doGenerate(options: unknown) {
        return {
          ...observe(options),
          content: [{ type: "text", text: "done" }],
        };
      },
      async doStream(options: unknown) {
        const result = observe(options);
        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "done" },
            { type: "finish", finishReason: result.finishReason },
          ]),
        };
      },
    };

    await runRuntime(
      mode,
      {
        id: `${mode}-revoked-checkpoint`,
        model: `hosted/${mode}-revoked-checkpoint`,
        system: "Use tools.",
        skills: false,
        tools: { list_projects: listProjectsTool() },
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfToolLoadingMode: "deferred",
        __vfToolExposureCheckpoint: checkpoint("get_release"),
      } as AgentConfig & RuntimeToolFilterConfig,
      "Continue",
    );

    assertEquals(observedTools, ["tool_search"]);
  });
}

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

it("stream checkpoint persistence rejection is reported before continuation", async () => {
  let modelCalls = 0;
  const model: ModelRuntime = {
    provider: "hosted",
    modelId: "hosted/rejected-stream-checkpoint-persister",
    async doGenerate() {
      return { content: [{ type: "text", text: "unused" }] };
    },
    async doStream() {
      modelCalls++;
      return {
        stream: createRuntimeStream(
          modelCalls === 1
            ? [
              {
                type: "tool-call",
                toolCallId: "search-1",
                toolName: "tool_search",
                input: { query: "get_release" },
              },
              { type: "finish", finishReason: "tool-calls" },
            ]
            : [
              { type: "text-delta", text: "must not run" },
              { type: "finish", finishReason: "stop" },
            ],
        ),
      };
    },
  };
  const body = await runRuntime(
    "stream",
    {
      id: "rejected-stream-checkpoint-persister",
      model: "hosted/rejected-stream-checkpoint-persister",
      system: "Use tools.",
      skills: false,
      tools: { get_release: releaseTool() },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
      __vfToolExposureCheckpointPersistenceRequired: true,
      __vfPersistToolExposureCheckpoint: () => Promise.reject(new Error("checkpoint rejected")),
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  assertEquals(modelCalls, 1);
  assertEquals(String(body).includes("checkpoint rejected"), true);
});
