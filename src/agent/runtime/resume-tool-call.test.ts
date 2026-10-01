import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type RemoteToolSource, tool } from "#veryfront/tool";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

it("executes a trusted pending tool call exactly once before model continuation", async () => {
  const executions: unknown[] = [];
  const model = scriptedModel([{ text: "continued" }], { only: "stream" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "resume-tool-call",
    system: "Continue after the resumed tool result.",
    tools: {
      lookup: tool({
        id: "lookup",
        description: "Lookup one record",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: (input) => {
          executions.push(input);
          return { matches: ["record-1"] };
        },
      }),
    },
    resolveModelTransport: () => Promise.resolve({ model }),
  }, {
    resumeToolCall: {
      id: "call-1:resume-1",
      name: "lookup",
      input: { query: "open" },
    },
  });

  const body = await (await assistant.stream({ input: "continue" })).toDataStreamResponse().text();

  assertEquals(executions, [{ query: "open" }]);
  assertStringIncludes(body, "call-1:resume-1");
  assertStringIncludes(body, '"query":"open"');
  const prompt = JSON.stringify(model.calls[0]?.prompt);
  assertStringIncludes(prompt, "call-1:resume-1");
  assertStringIncludes(prompt, "record-1");
});

it("records a denied trusted pending call and continues the model turn", async () => {
  const model = scriptedModel([{ text: "continued after denial" }], { only: "stream" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "resume-unauthorized-tool-call",
    system: "Continue only after the resumed tool result.",
    tools: {},
    resolveModelTransport: () => Promise.resolve({ model }),
  }, {
    resumeToolCall: {
      id: "call-unauthorized:resume-1",
      name: "outlook__list_messages",
      input: { folder: "inbox" },
    },
  });

  const body = await (await assistant.stream({ input: "continue" })).toDataStreamResponse().text();

  assertStringIncludes(
    body,
    'Tool \\"outlook__list_messages\\" is not available in the current model step',
  );
  assertStringIncludes(body, "continued after denial");
  assertEquals(model.calls.length, 1);
});

it("replays an authorized tool discovered by tool_search without the parked exposure state", async () => {
  const executions: unknown[] = [];
  const input = { folderId: "inbox", $top: 7 };
  const authenticationRequired = {
    error: "authentication_required",
    integration: "outlook",
    connectUrl: "https://api.example.test/oauth/connect/outlook?projectId=project-1",
    message: "Authentication required for Outlook.",
  };
  const outlook: RemoteToolSource = {
    id: "outlook",
    listTools: () =>
      Promise.resolve([{
        name: "outlook__list_threads",
        description: "List Outlook threads",
        parameters: {
          type: "object",
          properties: { folderId: { type: "string" }, $top: { type: "number" } },
          required: ["folderId", "$top"],
        },
      }]),
    executeTool: (_name, args) => {
      executions.push(args);
      return Promise.resolve(authenticationRequired);
    },
  };
  const parkedModel = scriptedModel([
    {
      toolCalls: [{
        id: "search-1",
        name: "tool_search",
        input: { query: "outlook__list_threads" },
      }],
    },
    { toolCalls: [{ id: "parked-1", name: "outlook__list_threads", input }] },
    { text: "Connect Outlook to continue." },
  ], { only: "stream" });
  const config: RuntimeToolFilterConfig = {
    id: "resume-deferred-integration",
    system: "List Outlook threads.",
    skills: false,
    tools: { outlook__list_threads: true },
    __vfRemoteToolSources: [outlook],
    __vfAllowedRemoteTools: ["outlook__list_threads"],
    __vfToolLoadingMode: "deferred",
    resolveModelTransport: () => ({ model: parkedModel }),
  };
  const parked = createEphemeralAgentWithRuntimeOptions(config, {});
  const parkedBody = await (await parked.stream({ input: "List my inbox." }))
    .toDataStreamResponse().text();
  assertEquals(parkedModel.toolNames(0), ["tool_search"]);
  assertEquals(parkedModel.toolNames(1), ["outlook__list_threads"]);
  assertStringIncludes(parkedBody, "authentication_required");
  assertEquals(executions, [input]);

  const resumedModel = scriptedModel([{ text: "Connect Outlook to continue." }], {
    only: "stream",
  });
  const resumed = createEphemeralAgentWithRuntimeOptions({
    ...config,
    resolveModelTransport: () => ({ model: resumedModel }),
  }, {
    resumeToolCall: { id: "parked-1:resume-1", name: "outlook__list_threads", input },
  });
  const resumedBody = await (await resumed.stream({ input: "continue" }))
    .toDataStreamResponse().text();

  assertEquals(executions, [input, input]);
  assertStringIncludes(resumedBody, "parked-1:resume-1");
  assertStringIncludes(resumedBody, "authentication_required");
  assertEquals(resumedBody.includes("not available in the current model step"), false);
  assertEquals(resumedBody.includes('"type":"error"'), false);
  assertEquals(resumedModel.toolNames(), ["tool_search"]);
  assertEquals(resumedModel.callCount, 1);
  assertStringIncludes(JSON.stringify(resumedModel.calls[0]?.prompt), "authentication_required");
});
