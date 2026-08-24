import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
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
    const model = scriptedModel([
      () => {
        callOrder.push("tool_search");
        return {
          toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "get_release" } }],
        };
      },
      () => {
        callOrder.push("next_model_step");
        return mode === "generate"
          ? { toolCalls: [{ id: "release-1", name: "get_release", input: {} }] }
          : { text: "done" };
      },
      { text: "done" },
    ], { modelId: `hosted/${mode}-durability-order` });
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
  const firstModel = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "get_release" } }] },
    { text: "pause" },
  ], { modelId: "hosted/checkpoint-first-invocation", only: "generate" });
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
  const resumedModel = scriptedModel([
    { toolCalls: [{ id: "release-1", name: "get_release", input: {} }] },
    { text: "done" },
  ], { modelId: "hosted/checkpoint-second-invocation", only: "generate" });
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

  assertEquals(resumedModel.toolNames(0).includes("get_release"), true);
  assertEquals(targetExecutions, 1);
  assertEquals(response.toolCalls.some((call) => call.name === "tool_search"), false);
});

it("stream exposes a restored tool on step zero without another search", async () => {
  let targetExecutions = 0;
  const model = scriptedModel([
    { toolCalls: [{ id: "release-1", name: "get_release", input: {} }] },
    { text: "done" },
  ], { modelId: "hosted/stream-restored-checkpoint", only: "stream" });

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

  assertEquals(model.toolNames(0), ["get_release"]);
  assertEquals(targetExecutions, 1);
});

for (const mode of ["generate", "stream"] as const) {
  it(`${mode} drops restored tools removed from the authorized catalog`, async () => {
    const model = scriptedModel(
      [{ text: "done" }],
      { modelId: `hosted/${mode}-revoked-checkpoint` },
    );

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

    assertEquals(model.toolNames(model.callCount - 1), ["tool_search"]);
  });
}

it("restores the invocation checkpoint only on step zero", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "list_projects" } }] },
    { text: "done" },
  ], { modelId: "hosted/checkpoint-step-zero", only: "generate" });
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

  assertEquals(model.toolNames(0).includes("get_release"), true);
  assertEquals(model.toolNames(1).includes("get_release"), true);
  assertEquals(model.toolNames(1).includes("list_projects"), true);
});

it("required durable checkpoint persistence fails closed when the callback is absent", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "get_release" } }] },
    { text: "must not run" },
  ], { modelId: "hosted/missing-checkpoint-persister", only: "generate" });
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
  assertEquals(model.callCount, 1);
});

it("checkpoint persistence rejection aborts before continuation and target execution", async () => {
  let targetExecutions = 0;
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "get_release" } }] },
    { toolCalls: [{ id: "release-1", name: "get_release", input: {} }] },
  ], { modelId: "hosted/rejected-checkpoint-persister", only: "generate" });
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
  assertEquals(model.callCount, 1);
  assertEquals(targetExecutions, 0);
});

it("stream checkpoint persistence rejection is reported before continuation", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "get_release" } }] },
    { text: "must not run" },
  ], { modelId: "hosted/rejected-stream-checkpoint-persister", only: "stream" });
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

  assertEquals(model.callCount, 1);
  assertEquals(String(body).includes("checkpoint rejected"), true);
});
