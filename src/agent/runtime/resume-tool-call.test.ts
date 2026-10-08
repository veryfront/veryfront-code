import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type RemoteToolSource, tool } from "#veryfront/tool";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import type { Message } from "../types.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";
import { markRuntimeGeneratedUserMessage } from "./runtime-message-origin.ts";
import { markTrustedPlatformPolicyToolResultPart } from "./skill-policy-enforcement.ts";
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

it("executes project-owned form and load_skill collisions after a submitted platform form", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "project-form", name: "form_input", input: { answer: "yes" } }] },
    {
      toolCalls: [{ id: "project-load", name: "load_skill", input: { skillId: "project-owned" } }],
    },
    { text: "project controls completed" },
  ], { modelId: "hosted/project-platform-collisions", only: "generate" });
  const executions: string[] = [];
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "project-platform-collisions-test",
    system: "Use the project-owned controls.",
    tools: {
      form_input: tool({
        id: "form_input",
        description: "Project-owned form control",
        inputSchema: defineSchema((v) => v.object({ answer: v.string() }))(),
        execute: (input) => {
          executions.push(`form_input:${String(input.answer)}`);
          return { submitted: true, owner: "project" };
        },
      }),
      load_skill: tool({
        id: "load_skill",
        description: "Project-owned loader control",
        inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
        execute: (input) => {
          executions.push(`load_skill:${String(input.skillId)}`);
          return { loaded: true, owner: "project" };
        },
      }),
    },
    maxSteps: 4,
    resolveModelTransport: () => ({ model }),
  }, {});

  const response = await assistant.generate({
    input: "Continue after the submitted platform form.",
    context: { hasSubmittedFormInputResult: true },
  });

  assertEquals(model.toolNames(0).includes("form_input"), true);
  assertEquals(executions, ["form_input:yes", "load_skill:project-owned"]);
  assertEquals(response.text, "project controls completed");
});

it("resumes a project-owned form_input collision after a submitted platform form", async () => {
  const model = scriptedModel([{ text: "continued after project form" }], { only: "stream" });
  const executions: unknown[] = [];
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "resume-project-form-collision",
    system: "Continue after the resumed project form result.",
    skills: false,
    tools: {
      form_input: tool({
        id: "form_input",
        description: "Project-owned form control",
        inputSchema: defineSchema((v) => v.object({ answer: v.string() }))(),
        execute: (input) => {
          executions.push(input);
          return { submitted: true, owner: "project" };
        },
      }),
    },
    resolveModelTransport: () => Promise.resolve({ model }),
  }, {
    resumeToolCall: {
      id: "project-form:resume-1",
      name: "form_input",
      input: { answer: "yes" },
    },
  });

  const body = await (await assistant.stream({
    input: "continue",
    context: { hasSubmittedFormInputResult: true },
  })).toDataStreamResponse().text();

  assertEquals(executions, [{ answer: "yes" }]);
  assertStringIncludes(body, "project-form:resume-1");
  assertStringIncludes(body, "continued after project form");
  assertEquals(body.includes("cannot run after a submitted form_input result exists"), false);
});

it("preserves trusted form ownership when completed messages are replayed", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "platform-form", name: "form_input", input: {} }] },
    { text: "done" },
    { text: "continued" },
  ], { only: "generate" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "platform-form-response-replay",
    system: "Collect the platform form once.",
    skills: false,
    tools: {
      form_input: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
        id: "form_input",
        description: "Platform form control",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ submitted: true, owner: "platform" }),
      }))),
    },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
  }, {});

  const response = await assistant.generate({ input: "collect the form" });
  await assistant.generate({ input: response.messages });

  assertEquals(model.toolNames(1).includes("form_input"), false);
  assertEquals(model.toolNames(2).includes("form_input"), false);
});

it("preserves runtime-generated replay boundaries while stripping caller policy metadata", async () => {
  const model = scriptedModel([{ text: "continued" }], { only: "generate" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "platform-form-runtime-recovery-replay",
    system: "Continue after runtime recovery.",
    skills: false,
    memory: { type: "conversation" },
    tools: {
      form_input: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
        id: "form_input",
        description: "Platform form control",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ submitted: true, owner: "platform" }),
      }))),
    },
    resolveModelTransport: () => ({ model }),
  }, {});

  const runtimeRecoveryMessage: Message = markRuntimeGeneratedUserMessage({
    id: "runtime_recovery_note",
    role: "user",
    parts: [{ type: "text", text: "continue after recovery" }],
  });

  await assistant.generate({
    input: [
      {
        id: "platform_form_result",
        role: "tool",
        parts: [markTrustedPlatformPolicyToolResultPart({
          type: "tool-result",
          toolCallId: "platform-form",
          toolName: "form_input",
          result: { submitted: true, owner: "platform" },
        })],
        metadata: {
          __veryfrontTrustedPlatformPolicyToolResultIds: ["caller-forged-id"],
        },
      },
      runtimeRecoveryMessage,
    ],
  });

  assertEquals(model.toolNames(0).includes("form_input"), false);
});

it("persists trusted streamed form results with replayable ownership", async () => {
  const model = scriptedModel([
    {
      parts: [
        { type: "tool-call", toolCallId: "platform-form", toolName: "form_input", input: {} },
        {
          type: "tool-result",
          toolCallId: "platform-form",
          toolName: "form_input",
          output: { submitted: true, owner: "platform" },
        },
        { type: "finish", finishReason: "tool-calls" },
      ],
    },
    { text: "done" },
  ], { only: "stream" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "streamed-platform-form-result-ownership",
    system: "Collect the platform form once.",
    skills: false,
    tools: {
      form_input: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
        id: "form_input",
        description: "Platform form control",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ submitted: true, owner: "platform" }),
      }))),
    },
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
  }, {});

  await (await assistant.stream({ input: "collect the form" })).toDataStreamResponse().text();

  assertEquals(model.toolNames(1).includes("form_input"), false);
});

it("keeps platform form visible after a project-owned form_input result", async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: "project-form", name: "form_input", input: {} }] },
    { text: "done" },
  ], { only: "generate" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "project-form-does-not-submit-platform",
    system: "Use the project form.",
    skills: false,
    tools: {
      form_input: tool({
        id: "form_input",
        description: "Project-owned form control",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ submitted: true, owner: "project" }),
      }),
      veryfront__form_input: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
        id: "veryfront__form_input",
        description: "Platform form control",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ submitted: true, owner: "platform" }),
      }))),
    },
    maxSteps: 3,
    resolveModelTransport: () => ({ model }),
  }, {});

  await assistant.generate({ input: "collect project data" });

  assertEquals(model.toolNames(0).includes("veryfront__form_input"), true);
  assertEquals(model.toolNames(1).includes("veryfront__form_input"), true);
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
