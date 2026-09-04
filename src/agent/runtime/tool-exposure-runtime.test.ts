import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
} from "#veryfront/utils/logger/logger.ts";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import { type ScriptedModel, scriptedModel } from "./model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./tool-inventory.ts";

function observedToolNames(model: ScriptedModel): string[][] {
  return model.calls.map((_, call) => model.toolNames(call));
}

it("deferred generate searches, exposes on the next step, and executes once", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "release marker" } }] },
    { toolCalls: [{ id: "marker-1", name: "read_release_marker", input: {} }] },
    { text: "Release marker marker-1" },
  ], { modelId: "hosted/deferred-tools", only: "generate" });
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

  const observedSystems = model.systemPrompts();
  assertEquals(model.toolNames(0), ["load_skill", "tool_search"]);
  assertEquals(model.toolNames(1), [
    "load_skill",
    "read_release_marker",
    "tool_search",
  ]);
  assertEquals((observedSystems[0] ?? "").includes("form_input"), false);
  assertEquals((observedSystems[0] ?? "").includes("read_release_marker"), false);
  assertEquals((observedSystems[1] ?? "").includes("read_release_marker"), false);
  assertEquals(executionCount, 1);
  assertEquals(response.text, "Release marker marker-1");
});

it("deferred generate can reload create_agent after a successful agent write", async () => {
  const model = scriptedModel([
    {
      toolCalls: [{
        id: "search-create-agent-1",
        name: "tool_search",
        input: { query: "create_agent" },
      }],
    },
    { toolCalls: [{ id: "create-agent-2", name: "create_agent", input: { id: "agent-2" } }] },
    {
      toolCalls: [{
        id: "search-create-agent-3",
        name: "tool_search",
        input: { query: "create_agent" },
      }],
    },
    { toolCalls: [{ id: "create-agent-4", name: "create_agent", input: { id: "agent-4" } }] },
    { text: "Created both agents." },
  ], { modelId: "hosted/deferred-agent-authoring", only: "generate" });
  let executionCount = 0;
  const assistant = agent(
    {
      id: "deferred-agent-authoring-test",
      model: "hosted/deferred-agent-authoring",
      system: flattenSystemInstructions(
        withRuntimeToolInventory(
          "Create both requested agents, loading create_agent when needed.",
          [],
        ),
      ),
      tools: {
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        create_agent: tool({
          id: "create_agent",
          description: "Create a project agent",
          inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          execute: ({ id }) => {
            executionCount++;
            return { id, source_path: `agents/${id}.ts` };
          },
        }),
        read_project_secret: tool({
          id: "read_project_secret",
          description: "Read a private project secret",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ value: "redacted" }),
        }),
      },
      maxSteps: 5,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Create two project agents" });

  const observedSystems = model.systemPrompts();
  assertEquals(observedToolNames(model), [
    ["load_skill", "tool_search"],
    ["create_agent", "load_skill", "tool_search"],
    ["load_skill", "tool_search"],
    ["create_agent", "load_skill", "tool_search"],
    ["load_skill", "tool_search"],
  ]);
  assertEquals(
    observedSystems[2]?.includes("- create_agent: Create a project agent"),
    true,
  );
  assertEquals(
    observedSystems[2]?.includes("- read_project_secret: Read a private project secret"),
    false,
  );
  assertEquals(executionCount, 2);
  assertEquals(response.text, "Created both agents.");
});

it("deferred stream can reload another agent write tool after a successful write", async () => {
  const model = scriptedModel([
    {
      toolCalls: [{
        id: "search-create-agent-1",
        name: "tool_search",
        input: { query: "create_agent" },
      }],
    },
    { toolCalls: [{ id: "create-agent-2", name: "create_agent", input: { id: "agent-2" } }] },
    {
      toolCalls: [{
        id: "search-create-agent-3",
        name: "tool_search",
        input: { query: "update_agent" },
      }],
    },
    { toolCalls: [{ id: "create-agent-4", name: "update_agent", input: { id: "agent-4" } }] },
    { text: "Created both agents." },
  ], { modelId: "hosted/deferred-agent-authoring-stream", only: "stream" });
  const executionCounts = { create: 0, update: 0 };
  const assistant = agent(
    {
      id: "deferred-agent-authoring-stream-test",
      model: "hosted/deferred-agent-authoring-stream",
      system: flattenSystemInstructions(
        withRuntimeToolInventory(
          "Create both requested agents, loading create_agent when needed.",
          [],
        ),
      ),
      tools: {
        load_skill: tool({
          id: "load_skill",
          description: "Load a skill",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({}),
        }),
        create_agent: tool({
          id: "create_agent",
          description: "Create a project agent",
          inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          execute: ({ id }) => {
            executionCounts.create++;
            return { id, source_path: `agents/${id}.ts` };
          },
        }),
        update_agent: tool({
          id: "update_agent",
          description: "Update a project agent",
          inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          execute: ({ id }) => {
            executionCounts.update++;
            return { id, source_path: `agents/${id}.ts` };
          },
        }),
        read_project_secret: tool({
          id: "read_project_secret",
          description: "Read a private project secret",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ value: "redacted" }),
        }),
      },
      maxSteps: 5,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.stream({ input: "Create two project agents" });
  const body = await response.toDataStreamResponse().text();

  const observedSystems = model.systemPrompts();
  assertEquals(observedToolNames(model), [
    ["load_skill", "tool_search"],
    ["create_agent", "load_skill", "tool_search"],
    ["load_skill", "tool_search"],
    ["load_skill", "tool_search", "update_agent"],
    ["load_skill", "tool_search"],
  ]);
  assertEquals(
    observedSystems[2]?.includes("- update_agent: Update a project agent"),
    true,
  );
  assertEquals(
    observedSystems[2]?.includes("- read_project_secret: Read a private project secret"),
    false,
  );
  assertEquals(executionCounts, { create: 1, update: 1 });
  assertEquals(body.includes("Created both agents."), true);
});

it("deferred generate activates and executes provider-native web search on demand", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-native-1", name: "tool_search", input: { query: "web_search" } }] },
    {
      content: [
        {
          type: "tool-call",
          toolCallId: "web-search-1",
          toolName: "web_search",
          input: JSON.stringify({ query: "Veryfront" }),
        },
        {
          type: "tool-result",
          toolCallId: "web-search-1",
          toolName: "web_search",
          result: { results: [{ title: "Veryfront" }] },
          providerExecuted: true,
        },
      ],
      finishReason: "tool-calls",
    },
    { text: "Found Veryfront." },
  ], { provider: "anthropic", modelId: "claude-sonnet-4-6", only: "generate" });
  const assistant = agent(
    {
      id: "deferred-provider-native-test",
      model: "anthropic/claude-sonnet-4-6",
      system: "Use web search when current information is required.",
      skills: false,
      tools: {},
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );

  const response = await assistant.generate({ input: "Search the web for Veryfront" });

  const observedSystems = model.systemPrompts();
  assertEquals(model.toolNames(0), ["tool_search"]);
  assertEquals(model.toolNames(1), ["tool_search", "web_search"]);
  assertEquals(model.toolNames(2), ["tool_search", "web_search"]);
  assertEquals((observedSystems[0] ?? "").includes("web_search"), false);
  assertEquals((observedSystems[0] ?? "").includes("web_fetch"), false);
  assertEquals((observedSystems[1] ?? "").includes("web_search"), false);
  assertEquals(response.toolCalls.map((call) => [call.name, call.status]), [
    ["tool_search", "completed"],
    ["web_search", "completed"],
  ]);
  assertEquals(response.text, "Found Veryfront.");
});

it("deferred generate rejects a guessed tool that was not exposed", async () => {
  let executionCount = 0;
  const model = scriptedModel([
    { toolCalls: [{ id: "guessed-1", name: "get_release", input: {} }] },
    { text: "done" },
  ], { modelId: "hosted/deferred-guessed-tool", only: "generate" });
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

it("uses captured membership checks when rejecting an unexposed tool", async () => {
  let executionCount = 0;
  const model = scriptedModel([
    { toolCalls: [{ id: "guessed-1", name: "get_release", input: {} }] },
    { text: "done" },
  ], { modelId: "hosted/deferred-captured-membership", only: "generate" });
  const assistant = agent(
    {
      id: "deferred-captured-membership",
      model: "hosted/deferred-captured-membership",
      system: "Use tools when needed.",
      skills: false,
      tools: {
        get_release: tool({
          id: "get_release",
          description: "Get the current release",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            executionCount += 1;
            return { id: "rel-1" };
          },
        }),
      },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );
  const originalSome = Array.prototype.some;
  Array.prototype.some = () => true;

  try {
    const response = await assistant.generate({ input: "Find the current release" });

    assertEquals(executionCount, 0);
    assertEquals(response.toolCalls[0]?.status, "error");
    assertEquals(
      response.toolCalls[0]?.error,
      'Tool "get_release" is not available in the current model step',
    );
  } finally {
    Array.prototype.some = originalSome;
  }
});
