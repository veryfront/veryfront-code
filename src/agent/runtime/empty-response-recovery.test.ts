import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import type { AgentConfig } from "../types.ts";
import { scriptedModel, type ScriptedTurn } from "./model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
const emptyUsage = { inputTokens: 1, outputTokens: 0, totalTokens: 1 };

function createUpdateFileTool(onExecute: () => void) {
  return tool({
    id: "update_file",
    description: "Update a project file",
    inputSchema: defineSchema((v) => v.object({ path: v.string(), content: v.string() }))(),
    execute: ({ path, content }) => {
      onExecute();
      return { path, content };
    },
  });
}

function createDeferredAgent(
  model: ReturnType<typeof scriptedModel>,
  onExecute: () => void,
  maxSteps = 4,
) {
  return agent(
    {
      id: "empty-response-recovery",
      model: model.modelId,
      system: "Update the requested file and report completion.",
      skills: false,
      tools: { update_file: createUpdateFileTool(onExecute) },
      maxSteps,
      resolveModelTransport: () => ({ model }),
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
  );
}

const updateFileCall = {
  id: "update-1",
  name: "update_file",
  input: { path: "src/app.ts", content: "updated" },
};

it("generate retries one empty stop after completed tools without replaying them", async () => {
  const model = scriptedModel([
    {
      content: [
        { type: "text", text: "I will update the file." },
        {
          type: "tool-call",
          toolCallId: "search-1",
          toolName: "tool_search",
          input: JSON.stringify({ query: "update_file" }),
        },
      ],
      finishReason: "tool-calls",
    },
    { content: [], finishReason: "stop" },
    { toolCalls: [updateFileCall] },
    { text: "Updated src/app.ts." },
  ], { modelId: "hosted/empty-response-generate", only: "generate" });
  let executions = 0;
  const assistant = createDeferredAgent(model, () => executions++);

  const response = await assistant.generate({ input: "Update src/app.ts" });

  assertEquals(model.callCount, 4);
  assertEquals(executions, 1);
  assertEquals(response.text, "Updated src/app.ts.");
  assertEquals(response.status, "completed");
});

it("stream retries one empty stop after completed tools without replaying them", async () => {
  const turns: ScriptedTurn[] = [
    {
      parts: [
        { type: "text-delta", text: "I will update the file." },
        {
          type: "tool-call",
          toolCallId: "search-1",
          toolName: "tool_search",
          input: { query: "update_file" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: usage },
      ],
    },
    { parts: [{ type: "finish", finishReason: "stop", totalUsage: emptyUsage }] },
    { toolCalls: [updateFileCall] },
    { text: "Updated src/app.ts." },
  ];
  const model = scriptedModel(turns, {
    modelId: "hosted/empty-response-stream",
    only: "stream",
  });
  let executions = 0;
  const assistant = createDeferredAgent(model, () => executions++);

  const response = await assistant.stream({ input: "Update src/app.ts" });
  const body = await response.toDataStreamResponse().text();

  assertEquals(model.callCount, 4);
  assertEquals(executions, 1);
  assertStringIncludes(body, "Updated src/app.ts.");
  assertEquals(body.includes('"type":"error"'), false);
});

it("generate rejects when the bounded empty-response retry is also empty", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "update_file" } }] },
    { content: [], finishReason: "stop" },
    { content: [], finishReason: "stop" },
  ], { modelId: "hosted/repeated-empty-generate", only: "generate" });
  let executions = 0;
  const assistant = createDeferredAgent(model, () => executions++);

  await assertRejects(
    () => assistant.generate({ input: "Update src/app.ts" }),
    Error,
    "without producing a response",
  );
  assertEquals(model.callCount, 3);
  assertEquals(executions, 0);
});

it("stream emits an error when the bounded empty-response retry is also empty", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "update_file" } }] },
    { parts: [{ type: "finish", finishReason: "stop", totalUsage: emptyUsage }] },
    { parts: [{ type: "finish", finishReason: "stop", totalUsage: emptyUsage }] },
  ], { modelId: "hosted/repeated-empty-stream", only: "stream" });
  let executions = 0;
  const assistant = createDeferredAgent(model, () => executions++);

  const response = await assistant.stream({ input: "Update src/app.ts" });
  const body = await response.toDataStreamResponse().text();

  assertEquals(model.callCount, 3);
  assertEquals(executions, 0);
  assertStringIncludes(body, '"type":"error"');
  assertStringIncludes(body, "without producing a response");
  assertEquals(body.includes('"type":"message-finish"'), false);
  assertStringIncludes(body, '"code":"EMPTY_RESPONSE"');
});

it("fails explicitly when an empty post-tool stop exhausts maxSteps", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "search-1", name: "tool_search", input: { query: "update_file" } }] },
    { content: [], finishReason: "stop" },
  ], { modelId: "hosted/empty-response-no-budget", only: "generate" });
  const assistant = createDeferredAgent(model, () => {}, 2);

  await assertRejects(
    () => assistant.generate({ input: "Update src/app.ts" }),
    Error,
    "without producing a response",
  );
  assertEquals(model.callCount, 2);
});

it("retains provider-executed tool history without replaying the billable work", async () => {
  let providerExecutions = 0;
  const model = scriptedModel([
    () => {
      providerExecutions++;
      return {
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
      };
    },
    { content: [], finishReason: "stop" },
    { text: "Search complete." },
  ], {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    only: "generate",
  });
  const assistant = agent({
    id: "empty-response-provider-tool",
    model: "anthropic/claude-sonnet-4-6",
    system: "Search and report the result.",
    skills: false,
    tools: {},
    providerTools: ["web_search"],
    maxSteps: 3,
    resolveModelTransport: () => ({ model }),
  });

  const response = await assistant.generate({ input: "Search for Veryfront" });

  assertEquals(providerExecutions, 1);
  assertEquals(model.callCount, 3);
  assertEquals(response.text, "Search complete.");
  const retryPrompt = JSON.stringify(model.calls[2]?.prompt);
  assertEquals(retryPrompt.match(/web-search-1/g)?.length, 1);
});
