import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { type RemoteToolSource, tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "../index.ts";
import type {
  AgentConfig,
  AgentResponse,
  Message,
  RuntimeStateRequest,
  ToolExecutionResultRequest,
} from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";
import {
  runtimeStream,
  scriptedModel,
  systemPromptOf,
  toolNamesOf,
} from "./model-runtime.test-helpers.ts";
import type { TextGenerationRuntimeMessage } from "./text-generation-runtime-message-types.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./tool-inventory.ts";
import { getRuntimeProjectSkillCatalog } from "./project-skill-catalog.ts";
import {
  createRuntimeProjectSkillLoader,
  type RuntimeProjectSkillContext,
} from "./project-skill-loader.ts";
import { hasSubmittedFormInputResult } from "./skill-policy-enforcement.ts";
import { isRuntimeGeneratedUserMessage } from "./runtime-message-origin.ts";
import { normalizeInput } from "./input-utils.ts";
import { cloneRuntimeStateMutableData } from "./index.ts";

function eagerAgent(config: Parameters<typeof agent>[0]): ReturnType<typeof agent> {
  return agent({ ...config, __vfToolLoadingMode: "eager" } as Parameters<typeof agent>[0]);
}

describe("runtime-state mutable data cloning", () => {
  it("keeps unknown values opaque after an unclassified clone failure", async () => {
    const structuredCloneDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "structuredClone",
    );
    let trapCalls = 0;
    try {
      Object.defineProperty(globalThis, "structuredClone", {
        configurable: true,
        value: () => {
          throw new TypeError("Unclassified clone failure");
        },
        writable: true,
      });
      const isolatedRuntime = await import(
        `./index.ts?unclassified-clone-failure=${crypto.randomUUID()}`
      );
      const proxy = new Proxy({}, {
        getPrototypeOf() {
          trapCalls += 1;
          return Object.prototype;
        },
        getOwnPropertyDescriptor() {
          trapCalls += 1;
          return undefined;
        },
        ownKeys() {
          trapCalls += 1;
          return [];
        },
      });

      assertStrictEquals(isolatedRuntime.cloneRuntimeStateMutableData(proxy, false), proxy);
      assertEquals(trapCalls, 0);
    } finally {
      if (structuredCloneDescriptor) {
        Object.defineProperty(globalThis, "structuredClone", structuredCloneDescriptor);
      }
    }
  });

  it("detaches ordinary records with a foreign Object.prototype chain", () => {
    const foreignObjectPrototype = Object.create(null);
    const foreign = Object.create(foreignObjectPrototype) as {
      nested: { value: string };
    };
    foreign.nested = Object.assign(Object.create(foreignObjectPrototype), {
      value: "original",
    }) as { value: string };

    const clone = cloneRuntimeStateMutableData(foreign);
    clone.nested.value = "changed";

    assertEquals(foreign.nested.value, "original");
    assertEquals(clone.nested.value, "changed");
  });

  it("preserves opaque proxies when no-hook proxy branding is unavailable", () => {
    let trapCalls = 0;
    const proxy = new Proxy({}, {
      getOwnPropertyDescriptor() {
        trapCalls++;
        return undefined;
      },
      ownKeys() {
        trapCalls++;
        return [];
      },
    });
    const revocable = Proxy.revocable([], {});
    revocable.revoke();

    assertStrictEquals(cloneRuntimeStateMutableData(proxy, false), proxy);
    assertStrictEquals(cloneRuntimeStateMutableData(revocable.proxy, false), revocable.proxy);
    assertEquals(trapCalls, 0);
  });

  it("detaches the active provider bucket around opaque leaves when proxy branding is unavailable", () => {
    const opaqueFunction = () => "opaque";
    const opaqueWeakMap = new WeakMap<object, unknown>();
    const source = [{
      role: "system" as const,
      content: "Original",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
        custom: {
          nested: { label: "original" },
          opaqueFunction,
          opaqueWeakMap,
        },
      },
    }];

    const clone = cloneRuntimeStateMutableData(source, false, "custom");
    clone[0]!.content = "Changed";
    clone[0]!.providerOptions.anthropic.cacheControl.type = "changed";
    clone[0]!.providerOptions.custom.nested = { label: "changed" };

    assertEquals(source[0]?.content, "Original");
    assertEquals(source[0]?.providerOptions.anthropic.cacheControl.type, "ephemeral");
    assertEquals(source[0]?.providerOptions.custom.nested.label, "original");
    assertStrictEquals(source[0]?.providerOptions.custom.opaqueFunction, opaqueFunction);
    assertStrictEquals(source[0]?.providerOptions.custom.opaqueWeakMap, opaqueWeakMap);
  });

  it("preserves nested opaque proxies without invoking traps when proxy branding is unavailable", () => {
    let trapCalls = 0;
    const opaqueProxy = new Proxy({}, {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    const source = [{
      role: "system" as const,
      content: "Original",
      providerOptions: { custom: opaqueProxy },
    }];

    const clone = cloneRuntimeStateMutableData(source, false);

    assertStrictEquals(clone[0]?.providerOptions.custom, opaqueProxy);
    clone[0]!.content = "Changed";
    clone[0]!.providerOptions.custom = {};

    assertEquals(source[0]?.content, "Original");
    assertStrictEquals(source[0]?.providerOptions.custom, opaqueProxy);
    assertEquals(trapCalls, 0);
  });

  it("detaches provider buckets around nested opaque proxies when proxy branding is unavailable", () => {
    let trapCalls = 0;
    const opaqueProxy = new Proxy({}, {
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });
    const source = [{
      role: "system" as const,
      content: "Original",
      providerOptions: {
        bedrock: {
          cacheControl: { type: "ephemeral" },
          opaqueProxy,
        },
      },
    }];

    const clone = cloneRuntimeStateMutableData(source, false, "bedrock");
    clone[0]!.providerOptions.bedrock.cacheControl.type = "changed";

    assertEquals(source[0]?.providerOptions.bedrock.cacheControl.type, "ephemeral");
    assertStrictEquals(clone[0]?.providerOptions.bedrock.opaqueProxy, opaqueProxy);
    assertEquals(trapCalls, 0);
  });

  it("copies active provider metadata accessors without invoking them", () => {
    let getterCalls = 0;
    const bedrock = {
      cacheControl: { type: "ephemeral" },
    } as Record<string, unknown>;
    Object.defineProperty(bedrock, "opaqueMetadata", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return "opaque";
      },
    });
    const source = [{
      role: "system" as const,
      content: "Original",
      providerOptions: { bedrock },
    }];

    const clone = cloneRuntimeStateMutableData(source, false, "bedrock");
    const clonedCacheControl = clone[0]?.providerOptions.bedrock.cacheControl as {
      type: string;
    };
    clonedCacheControl.type = "changed";

    assertEquals(getterCalls, 0);
    assertEquals((bedrock.cacheControl as { type: string }).type, "ephemeral");
    assertEquals(
      typeof Object.getOwnPropertyDescriptor(
        clone[0]?.providerOptions.bedrock,
        "opaqueMetadata",
      )?.get,
      "function",
    );
  });

  it("preserves nested provider metadata accessors without invoking them", () => {
    let getterCalls = 0;
    const transportHints = Object.defineProperty(
      { mutable: { region: "original" } },
      "computedRegion",
      {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          return "us-east-1";
        },
      },
    );
    const source = [{
      role: "system" as const,
      content: "Original",
      providerOptions: {
        bedrock: {
          cacheControl: { type: "ephemeral" },
          transportHints,
        },
      },
    }];

    const clone = cloneRuntimeStateMutableData(source, false, "bedrock");
    const clonedHints = clone[0]?.providerOptions.bedrock.transportHints;

    assertEquals(getterCalls, 0);
    assertStrictEquals(clonedHints, transportHints);
    assertEquals(
      typeof Object.getOwnPropertyDescriptor(clonedHints, "computedRegion")?.get,
      "function",
    );
  });
});

async function readResponseBody(
  response: Response,
  onText?: (text: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  assertExists(reader);
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      body += decoder.decode();
      return body;
    }
    const text = decoder.decode(value, { stream: true });
    body += text;
    onText?.(body);
  }
}

function supplierInvoiceEvidenceMessages(): Message[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Process open supplier invoices" }],
      timestamp: 1,
    },
    {
      id: "assistant-ingest",
      role: "assistant",
      parts: [{
        type: "tool-invoke_agent",
        toolCallId: "invoke-ingest-1",
        toolName: "invoke_agent",
        args: {
          agent_id: "ingest-invoice-agent",
          prompt: "Load open supplier invoices",
        },
      }],
      timestamp: 2,
    },
    {
      id: "tool-ingest",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "invoke-ingest-1",
        toolName: "invoke_agent",
        result: {
          status: "completed",
          summary: {
            text: "Ingestion complete. 2 open invoices loaded:\n\n" +
              "| Invoice | Supplier | Route |\n" +
              "| --- | --- | --- |\n" +
              "| INV-2026-00482 | Alpine Claims Services | Escalation (blocked) |\n" +
              "| INV-2026-00491 | Meyer Papier GmbH | Matching (valid) |\n",
          },
        },
      }],
      timestamp: 3,
    },
  ];
}

function submittedFormWithActiveSkillMessages(): Message[] {
  return [
    {
      id: "skill-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "load-plan",
        toolName: "load_skill",
        result: {
          skillId: "plan",
          instructions: "# Plan",
          allowedTools: ["load_skill"],
          references: ["references/guide.md"],
          scripts: [],
        },
      }],
    },
    {
      id: "form-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "collect-plan-input",
        toolName: "form_input",
        result: { submitted: true, values: { topic: "Runtime policy" } },
      }],
    },
  ];
}

describe("agent runtime refresh hooks", () => {
  it("keeps one authoritative UTC snapshot across refreshed scheduled-run steps", async () => {
    using time = new FakeTime(new Date("2026-07-19T07:30:00.000Z"));
    const model = scriptedModel([
      () => {
        time.tick(24 * 60 * 60 * 1_000);
        return { toolCalls: [{ id: "continue-1", name: "continue_run", input: {} }] };
      },
      { text: "2026-07-19" },
    ], { modelId: "hosted/runtime-context-snapshot", only: "generate" });
    const continueRun = tool({
      id: "continue_run",
      description: "Continue the run",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    });
    const assistant = eagerAgent({
      model: "hosted/runtime-context-snapshot",
      system: "Create today's report.",
      tools: { continue_run: continueRun },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: ({ step }) =>
        step === 0 ? undefined : {
          system:
            "Refreshed project instructions.\n\n<runtime_context>\ncurrent_date_utc: 2025-07-14\n</runtime_context>",
        },
    });

    const response = await assistant.generate({
      input: "Create the scheduled report.",
      context: { scheduleId: "schedule-1" },
    });

    const observedSystems = model.systemPrompts();
    assertEquals(observedSystems.length, 2);
    for (const system of observedSystems) {
      assertEquals(system.match(/<runtime_context>/g)?.length, 1);
      assertEquals(system.includes("2025-07-14"), false);
      assertEquals(system.includes("2026-07-20"), false);
      assertEquals(system.includes("run_started_at_utc: 2026-07-19T07:30:00.000Z"), true);
    }
    assertEquals(response.metadata?.runtimeContext, {
      currentTimeUtc: "2026-07-19T07:30:00.000Z",
      currentDateUtc: "2026-07-19",
      runStartedAtUtc: "2026-07-19T07:30:00.000Z",
    });
  });

  it("continues suppressed unavailable tool calls with a user recovery turn after assistant text", async () => {
    const observedPrompts: Array<Array<{ role?: string; content?: unknown }>> = [];
    const observedRuntimeMessages: Message[][] = [];
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/suppressed-tool-recovery",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedPrompts.push(
          (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt ?? [],
        );

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "I will reload the skill." },
              { type: "tool-input-start", id: "tc-stale", toolName: "stale_tool" },
              { type: "tool-input-delta", id: "tc-stale", delta: '{"query":"create-agent"}' },
              { type: "tool-input-end", id: "tc-stale" },
              {
                type: "tool-call",
                toolCallId: "tc-stale",
                toolName: "stale_tool",
                input: { query: "create-agent" },
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Recovered." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/suppressed-tool-recovery",
      system: "Recover from stale tools.",
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState({ messages }) {
        observedRuntimeMessages.push(messages);
        return {};
      },
    });

    await (await assistant.stream({
      messages: submittedFormWithActiveSkillMessages(),
      onFinish: (response) => {
        finishedResponse = response;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    const runtimeMessages = observedRuntimeMessages[1] ?? [];
    assertEquals(runtimeMessages.at(-1)?.role, "user");
    assertEquals(
      isRuntimeGeneratedUserMessage(runtimeMessages.at(-1) ?? {}),
      true,
    );
    const retryPrompt = observedPrompts[1] ?? [];
    assertEquals(retryPrompt.at(-1)?.role, "user");
    assertEquals(
      JSON.stringify(retryPrompt.at(-1)?.content).includes(
        "ignored unavailable tool call(s): stale_tool",
      ),
      true,
    );
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    const recoveryMessage = completedResponse.messages.find((message) =>
      message.id.startsWith("runtime_note_")
    );
    assertExists(recoveryMessage);
    assertEquals(isRuntimeGeneratedUserMessage(recoveryMessage), true);
    assertEquals(hasSubmittedFormInputResult(completedResponse.messages), true);
    assertEquals(hasSubmittedFormInputResult(normalizeInput(completedResponse.messages)), true);
  });

  it("keeps valid parallel tool results before suppressed-tool recovery guidance", async () => {
    const observedPrompts: TextGenerationRuntimeMessage[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/mixed-suppressed-tool-recovery",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedPrompts.push(
          (options as { prompt?: TextGenerationRuntimeMessage[] }).prompt ?? [],
        );

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "tc-stale",
                toolName: "stale_tool",
                input: { query: "ignored" },
              },
              {
                type: "tool-call",
                toolCallId: "tc-github",
                toolName: "get_github",
                input: { query: "pull requests" },
              },
              {
                type: "tool-call",
                toolCallId: "tc-slack",
                toolName: "get_slack",
                input: { query: "daily channel" },
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Recovered." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };
    const getGithub = tool({
      id: "get_github",
      description: "Get GitHub integration details",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: ({ query }) => ({ integration: "github", query }),
    });
    const getSlack = tool({
      id: "get_slack",
      description: "Get Slack integration details",
      inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
      execute: ({ query }) => ({ integration: "slack", query }),
    });
    const assistant = eagerAgent({
      model: "hosted/mixed-suppressed-tool-recovery",
      system: "Recover from stale tools after checking integrations.",
      tools: { get_github: getGithub, get_slack: getSlack },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    await (await assistant.stream({ input: "Build an agent" })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    const retryPrompt = observedPrompts[1] ?? [];
    assertEquals(
      retryPrompt.slice(-3).map((message) => message.role),
      ["assistant", "tool", "user"],
    );
    assertEquals(retryPrompt.at(-3), {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc-github",
          toolName: "get_github",
          input: { query: "pull requests" },
        },
        {
          type: "tool-call",
          toolCallId: "tc-slack",
          toolName: "get_slack",
          input: { query: "daily channel" },
        },
      ],
    });
    assertEquals(retryPrompt.at(-2), {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-github",
          toolName: "get_github",
          output: {
            type: "json",
            value: { integration: "github", query: "pull requests" },
          },
        },
        {
          type: "tool-result",
          toolCallId: "tc-slack",
          toolName: "get_slack",
          output: {
            type: "json",
            value: { integration: "slack", query: "daily channel" },
          },
        },
      ],
    });
    assertEquals(
      JSON.stringify(retryPrompt.at(-1)?.content).includes(
        "ignored unavailable tool call(s): stale_tool",
      ),
      true,
    );
  });

  it("notifies configured hooks after generate() executes a tool", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "write-1",
          name: "write_report",
          input: '{"path":"research/report.md"}',
        }],
      },
    ], { modelId: "hosted/tool-result-generate", only: "generate" });

    const writeReport = tool({
      id: "write_report",
      description: "Write a report",
      inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
      execute: async ({ path }, context) => ({
        path: `canonical/${path}`,
        projectId: context?.projectId,
      }),
    });

    const assistant = eagerAgent({
      model: "hosted/tool-result-generate",
      system: "Generate tool result hook test",
      tools: { write_report: writeReport },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    await assistant.generate({
      input: "Write a report",
      context: { projectId: "project-generate" },
    });

    assertEquals(toolResults.length, 1);
    assertEquals(toolResults[0]?.toolName, "write_report");
    assertEquals(toolResults[0]?.toolCallId, "write-1");
    assertEquals(toolResults[0]?.input, { path: "research/report.md" });
    assertEquals(toolResults[0]?.result, {
      path: "canonical/research/report.md",
      projectId: "project-generate",
    });
    assertEquals(toolResults[0]?.context?.projectId, "project-generate");
  });

  it("preserves the finish reason when generate() stops without final text", async () => {
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "write-1",
          name: "write_report",
          input: '{"path":"research/report.md"}',
        }],
      },
      { content: [], finishReason: "stop" },
    ], { modelId: "hosted/empty-final-text", only: "generate" });

    const writeReport = tool({
      id: "write_report",
      description: "Write a report",
      inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
      execute: ({ path }) => ({ path, created: true }),
    });

    const assistant = eagerAgent({
      model: "hosted/empty-final-text",
      system: "Write the report and summarize the result.",
      tools: { write_report: writeReport },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = await assistant.generate({ input: "Write a report" });

    assertEquals(model.callCount, 2);
    assertEquals(response.status, "completed");
    assertEquals(response.text, "");
    assertEquals(response.metadata?.finishReason, "stop");
    assertEquals(response.toolCalls[0]?.status, "completed");
  });

  it("classifies structured errors returned during generate()", async () => {
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "update-agent-generate-error-1",
          name: "update_agent",
          input: '{"id":"jira-agent"}',
        }],
      },
      { text: "I can retry with the required input." },
    ], { provider: "anthropic", modelId: "claude-sonnet-4-6", only: "generate" });

    const updateError = {
      error: "tool_error",
      message: "Invalid input - system: system or system_prompt is required",
    };
    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => updateError,
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and recover from failed tool calls.",
      tools: { update_agent: updateAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = await assistant.generate({
      input: "Attach the project skill to my Jira agent",
    });

    assertEquals(model.callCount, 2);
    assertEquals(model.toolNames(1).includes("update_agent"), true);
    assertEquals(model.toolNames(1).includes("web_search"), true);
    assertEquals(model.toolNames(1).includes("web_fetch"), true);
    assertEquals(response.toolCalls[0]?.status, "error");
    assertEquals(response.toolCalls[0]?.error, updateError.message);
    assertEquals(response.toolCalls[0]?.result, updateError);
  });

  it("forces a final response after create_agent succeeds during generate()", async () => {
    let executionCount = 0;
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "create-agent-generate-1",
          name: "create_agent",
          input: '{"id":"gmail-assistant-e2e"}',
        }],
      },
      {
        toolCalls: [{
          id: "create-agent-generate-guessed-2",
          name: "create_agent",
          input: '{"id":"guessed-second-agent"}',
        }],
      },
      { text: "Created Gmail Assistant." },
    ], { provider: "anthropic", modelId: "claude-sonnet-4-6", only: "generate" });

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => {
        executionCount++;
        return {
          id,
          name: "Gmail Assistant",
          source_path: `agents/${id}.ts`,
        };
      },
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: flattenSystemInstructions(
        withRuntimeToolInventory(
          "Create agents and summarize successful tool results.",
          ["create_agent", "web_fetch", "web_search"],
        ),
      ),
      tools: { create_agent: createAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = await assistant.generate({ input: "Create a Gmail agent" });

    assertEquals(model.callCount, 3);
    assertEquals(model.toolNames(0).includes("create_agent"), true);
    assertEquals(model.toolNames(0).includes("web_search"), true);
    assertEquals(model.toolNames(0).includes("web_fetch"), true);
    assertEquals(model.toolNames(1), ["load_skill"]);
    assertEquals(model.systemPrompts()[1]?.includes("- create_agent"), false);
    assertEquals(model.systemPrompts()[1]?.includes("- load_skill"), true);
    assertEquals(executionCount, 1);
    assertEquals(response.toolCalls[1]?.status, "error");
    assertEquals(
      response.toolCalls[1]?.error,
      'Tool "create_agent" is not available in the current model step',
    );
  });

  it("omits provider-native tools unsupported by the configured model", async () => {
    const model = scriptedModel(
      [{ text: "done" }],
      { provider: "google", modelId: "gemini-3.5-flash", only: "generate" },
    );

    const assistant = eagerAgent({
      model: "google/gemini-3.5-flash",
      system: flattenSystemInstructions(
        withRuntimeToolInventory("Use configured tools.", ["web_search", "web_fetch"]),
      ),
      providerTools: ["web_search", "web_fetch"],
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "Search the web" });

    // Google exposes neither native tool, so neither may reach the inventory.
    const capturedSystem = model.systemPrompts()[0] ?? "";
    assertEquals(capturedSystem.includes("- web_search"), false);
    assertEquals(capturedSystem.includes("- web_fetch"), false);
  });

  it("removes provider-native tools from the forced final response after create_agent", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    let executionCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        if (callCount === 2) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "create-agent-guessed-2",
                toolName: "create_agent",
                input: '{"id":"guessed-second-agent"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "create-agent-1",
                toolName: "create_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Created Gmail Assistant." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => {
        executionCount++;
        return {
          id,
          name: "Gmail Assistant",
          source_path: `agents/${id}.ts`,
        };
      },
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Create agents and summarize successful tool results.",
      tools: { create_agent: createAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Create a Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
    assertEquals(toolNamesByStep[1], ["load_skill"]);
    assertEquals(executionCount, 1);
  });

  for (const agentWriteToolName of ["create_agent", "update_agent"] as const) {
    it(`keeps follow-up project tools available after ${agentWriteToolName} for scheduled-agent flows`, async () => {
      const toolNamesByStep: string[][] = [];
      const executedTools: string[] = [];
      let callCount = 0;
      const model: ModelRuntime = {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        async doGenerate() {
          return {
            content: [{ type: "text", text: "unused" }],
            finishReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
        async doStream(options) {
          const rawTools = (options as { tools?: unknown }).tools;
          const toolNames = Array.isArray(rawTools)
            ? rawTools.map((entry) =>
              (entry as { name?: string; id?: string }).name ??
                (entry as { name?: string; id?: string }).id ?? ""
            )
            : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
          toolNamesByStep.push(toolNames);
          callCount++;

          if (callCount === 1) {
            return {
              stream: runtimeStream([
                {
                  type: "tool-call",
                  toolCallId: "agent-write-1",
                  toolName: agentWriteToolName,
                  input: '{"id":"hourly-triage-agent"}',
                },
                {
                  type: "finish",
                  finishReason: "tool-calls",
                  totalUsage: { inputTokens: 1, outputTokens: 1 },
                },
              ]),
            };
          }

          if (callCount === 2 && toolNames.includes("create_schedule")) {
            return {
              stream: runtimeStream([
                {
                  type: "tool-call",
                  toolCallId: "create-schedule-1",
                  toolName: "create_schedule",
                  input: JSON.stringify({
                    target: {
                      kind: "agent",
                      id: "hourly-triage-agent",
                      conversation_mode: "create_new",
                    },
                    schedule: "0 * * * *",
                    timezone: "Europe/Berlin",
                    config: {
                      prompt: "Check project status and report whether any tasks need attention.",
                    },
                  }),
                },
                {
                  type: "finish",
                  finishReason: "tool-calls",
                  totalUsage: { inputTokens: 1, outputTokens: 1 },
                },
              ]),
            };
          }

          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Scheduled agent created." },
              {
                type: "finish",
                finishReason: "stop",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        },
      };

      const agentWriteTool = tool({
        id: agentWriteToolName,
        description: agentWriteToolName === "create_agent"
          ? "Create a Studio project agent"
          : "Update a Studio project agent",
        inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        execute: async ({ id }) => {
          executedTools.push(agentWriteToolName);
          return {
            id,
            name: "Hourly Triage Agent",
            source_path: `agents/${id}.ts`,
          };
        },
      });

      const createSchedule = tool({
        id: "create_schedule",
        description: "Create a Studio schedule",
        inputSchema: defineSchema((v) =>
          v.object({
            target: v.object({
              kind: v.literal("agent"),
              id: v.string(),
              conversation_mode: v.string(),
            }),
            schedule: v.string(),
            timezone: v.string(),
            config: v.object({ prompt: v.string() }),
          })
        )(),
        execute: async ({ target, schedule, timezone }) => {
          executedTools.push("create_schedule");
          return {
            id: "schedule-hourly-triage",
            status: "active",
            target,
            schedule,
            timezone,
          };
        },
      });

      const assistant = eagerAgent({
        model: "anthropic/claude-sonnet-4-6",
        system:
          `Create scheduled agents. After ${agentWriteToolName} succeeds, call create_schedule before final output.`,
        tools: {
          [agentWriteToolName]: agentWriteTool,
          create_schedule: createSchedule,
        },
        skills: true,
        providerTools: ["web_search", "web_fetch"],
        maxSteps: 4,
        resolveModelTransport: async () => ({ model }),
      });

      const response = (await assistant.stream({
        input: "Create or update an agent and schedule it hourly.",
      })).toDataStreamResponse();

      await response.text();
      assertEquals(toolNamesByStep[0]?.includes(agentWriteToolName), true);
      assertEquals(toolNamesByStep[0]?.includes("create_schedule"), true);
      assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
      assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
      assertEquals(toolNamesByStep[1], ["create_schedule", "load_skill"]);
      assertEquals(toolNamesByStep.length, 3);
      assertEquals(executedTools, [agentWriteToolName, "create_schedule"]);
    });
  }

  it("keeps tools available after a failed create_agent attempt", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "create-agent-1",
                toolName: "create_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "I can retry with corrected agent input." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => {
        throw new Error("Agent already exists");
      },
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Create agents and recover from failed tool calls.",
      tools: { create_agent: createAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Create a Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_fetch"), true);
  });

  it("keeps tools available after update_agent returns a structured error", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "update-agent-error-1",
                toolName: "update_agent",
                input: '{"id":"jira-agent"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "I can retry with the required input." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const updateError = {
      error: "tool_error",
      message: "Invalid input - system: system or system_prompt is required",
    };
    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => updateError,
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and recover from failed tool calls.",
      tools: { update_agent: updateAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Attach the project skill to my Jira agent",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();

    const streamBody = await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_fetch"), true);
    assertEquals(streamBody.includes('"type":"tool-output-error"'), true);
    assertEquals(streamBody.includes('"type":"tool-output-available"'), false);
    assertEquals(streamBody.includes(updateError.message), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.toolCalls[0]?.status, "error");
    assertEquals(finishedResponse.toolCalls[0]?.error, updateError.message);
    assertEquals(finishedResponse.toolCalls[0]?.result, updateError);
  });

  it("streams integration authentication actions without flattening their structured output", async () => {
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "gmail-list-emails-auth-1",
                toolName: "gmail__list_emails",
                input: {},
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Connect Gmail to continue." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const authenticationRequired = {
      error: "authentication_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail?projectId=project-1",
      message: "Authentication required for Gmail.",
    };
    const gmailSource: RemoteToolSource = {
      id: "gmail",
      listTools: () =>
        Promise.resolve([{
          name: "gmail__list_emails",
          description: "List Gmail messages",
          parameters: { type: "object", properties: {} },
        }]),
      executeTool: () => Promise.resolve(authenticationRequired),
    };
    const assistant = eagerAgent(
      {
        model: "anthropic/claude-sonnet-4-6",
        system: "Use Gmail when requested.",
        tools: { gmail__list_emails: true },
        __vfRemoteToolSources: [gmailSource],
        __vfAllowedRemoteTools: ["gmail__list_emails"],
        maxSteps: 2,
        resolveModelTransport: async () => ({ model }),
      } as AgentConfig & RuntimeRemoteToolConfig,
    );

    const response = (await assistant.stream({
      input: "Summarize my inbox",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(callCount, 2);
    assertEquals(streamBody.includes('"type":"tool-output-available"'), true);
    assertEquals(streamBody.includes('"type":"tool-output-error"'), false);
    assertEquals(streamBody.includes('"error":"authentication_required"'), true);
    assertEquals(streamBody.includes(authenticationRequired.connectUrl), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.toolCalls[0]?.status, "completed");
    assertEquals(finishedResponse.toolCalls[0]?.result, authenticationRequired);
  });

  it("keeps skill file tools hidden after a failed load_skill attempt", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "load-missing-skill",
                toolName: "load_skill",
                input: '{"skillId":"missing"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "I could not load that skill." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({ error: "Skill not found" }),
    });
    const loadSkillReference = tool({
      id: "load_skill_reference",
      description: "Load a skill reference",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string(), reference: v.string() }))(),
      execute: () => ({ content: "reference" }),
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Recover from a missing skill.",
      tools: {
        load_skill: loadSkill,
        load_skill_reference: loadSkillReference,
      },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Load the missing skill",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("load_skill"), true);
    assertEquals(toolNamesByStep[0]?.includes("load_skill_reference"), false);
    assertEquals(toolNamesByStep[1]?.includes("load_skill"), true);
    assertEquals(toolNamesByStep[1]?.includes("load_skill_reference"), false);
  });

  it("removes provider-native tools from the forced final response after update_agent", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "update-agent-1",
                toolName: "update_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Updated Gmail Assistant." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => ({
        id,
        name: "Gmail Assistant",
        source_path: `agents/${id}.ts`,
      }),
    });

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and summarize successful tool results.",
      tools: { update_agent: updateAgent },
      skills: true,
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Update my Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
    assertEquals(toolNamesByStep[1], ["load_skill"]);
  });

  it("notifies configured hooks after stream() executes a tool", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/tool-result-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "write-stream-1",
                toolName: "write_report",
                input: '{"path":"research/stream-report.md"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "stream complete" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const writeReport = tool({
      id: "write_report",
      description: "Write a report",
      inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
      execute: async ({ path }, context) => ({
        path: `canonical/${path}`,
        projectId: context?.projectId,
      }),
    });

    const assistant = eagerAgent({
      model: "hosted/tool-result-stream",
      system: "Stream tool result hook test",
      tools: { write_report: writeReport },
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({
      input: "Write a report",
      context: { projectId: "project-stream" },
    })).toDataStreamResponse();

    const body = await response.text();

    assertEquals(toolResults.length, 1);
    assertEquals(/"type":"text-start","id":"[^"]+:step:1"/.test(body), true);
    assertEquals(toolResults[0]?.toolName, "write_report");
    assertEquals(toolResults[0]?.toolCallId, "write-stream-1");
    assertEquals(toolResults[0]?.input, { path: "research/stream-report.md" });
    assertEquals(toolResults[0]?.result, {
      path: "canonical/research/stream-report.md",
      projectId: "project-stream",
    });
    assertEquals(toolResults[0]?.context?.projectId, "project-stream");
  });

  it("retries a wholly uncommitted local tool batch without partially executing it", async () => {
    const executedMutations: string[] = [];
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/interrupted-tool-batch",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Applying the requested updates." },
              {
                type: "tool-input-start",
                id: "truncated-agent",
                toolName: "issue466_update_agent",
              },
              {
                type: "tool-input-delta",
                id: "truncated-agent",
                delta: '{"revision":"truncated',
              },
              {
                type: "finish",
                finishReason: "stop",
                totalUsage: { inputTokens: 0, outputTokens: 0 },
              },
            ]),
          };
        }

        if (callCount === 2) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "retry-file",
                toolName: "issue466_update_file",
                input: '{"revision":"retry-file"}',
              },
              {
                type: "tool-call",
                toolCallId: "retry-agent-1",
                toolName: "issue466_update_agent",
                input: '{"revision":"retry-agent-1"}',
              },
              {
                type: "tool-call",
                toolCallId: "retry-agent-2",
                toolName: "issue466_update_agent",
                input: '{"revision":"retry-agent-2"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Recovered after interrupted tool batch." },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const mutationTool = (id: string) =>
      tool({
        id,
        description: `Apply ${id}`,
        inputSchema: defineSchema((v) => v.object({ revision: v.string() }))(),
        execute: async ({ revision }) => {
          executedMutations.push(revision);
          return { revision };
        },
      });

    const assistant = eagerAgent({
      model: "hosted/interrupted-tool-batch",
      system: "Apply every requested mutation and recover interrupted model streams.",
      tools: {
        issue466_update_file: mutationTool("issue466_update_file"),
        issue466_update_agent: mutationTool("issue466_update_agent"),
      },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Update the taxonomy and both agents",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await response.text();

    assertEquals(callCount, 3);
    assertEquals(executedMutations, ["retry-file", "retry-agent-1", "retry-agent-2"]);
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 0);
    assertEquals(body.includes("Recovered after interrupted tool batch."), true);
    assertExists(finishedResponse);
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => [toolCall.id, toolCall.status]),
      [
        ["retry-file", "completed"],
        ["retry-agent-1", "completed"],
        ["retry-agent-2", "completed"],
      ],
    );
  });

  it("fails closed after a local sibling was exposed, with or without a final result", async () => {
    for (const hasFinalResult of [false, true]) {
      const executedMutations: string[] = [];
      let callCount = 0;
      const model: ModelRuntime = {
        provider: "hosted",
        modelId: `hosted/interrupted-exposed-batch-${hasFinalResult}`,
        async doGenerate() {
          return {
            content: [{ type: "text", text: "unused" }],
            finishReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
        async doStream() {
          callCount++;
          if (callCount > 1) {
            return {
              stream: runtimeStream([
                { type: "text-delta", text: "Unexpected recovery." },
                { type: "finish", finishReason: "stop" },
              ]),
            };
          }

          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "exposed-file",
                toolName: "issue466_update_file",
                input: '{"revision":"already-exposed"}',
              },
              ...(hasFinalResult
                ? [{
                  type: "tool-result" as const,
                  toolCallId: "exposed-file",
                  toolName: "issue466_update_file",
                  output: { revision: "already-applied" },
                }]
                : []),
              {
                type: "tool-input-start",
                id: "truncated-agent-after-exposure",
                toolName: "issue466_update_agent",
              },
              {
                type: "tool-input-delta",
                id: "truncated-agent-after-exposure",
                delta: '{"revision":"truncated',
              },
              {
                type: "finish",
                finishReason: "stop",
                totalUsage: { inputTokens: 0, outputTokens: 0 },
              },
            ]),
          };
        },
      };

      const mutationTool = (id: string) =>
        tool({
          id,
          description: `Apply ${id}`,
          inputSchema: defineSchema((v) => v.object({ revision: v.string() }))(),
          execute: async ({ revision }) => {
            executedMutations.push(revision);
            return { revision };
          },
        });

      const assistant = eagerAgent({
        model: `hosted/interrupted-exposed-batch-${hasFinalResult}`,
        system: "Do not repeat an interrupted batch after exposing a local tool call.",
        tools: {
          issue466_update_file: mutationTool("issue466_update_file"),
          issue466_update_agent: mutationTool("issue466_update_agent"),
        },
        maxSteps: 3,
        resolveModelTransport: async () => ({ model }),
      });

      const response = (await assistant.stream({
        input: "Update the taxonomy and agent",
      })).toDataStreamResponse();
      const body = await response.text();

      assertEquals(callCount, 1);
      assertEquals(executedMutations, []);
      assertEquals(body.match(/"type":"tool-input-available"/g)?.length ?? 0, 1);
      assertEquals(
        body.match(/"type":"tool-output-available"/g)?.length ?? 0,
        hasFinalResult ? 1 : 0,
      );
      // #3737. Failing closed is about not re-running the batch, not about
      // hiding the truncation. The exposed sibling rendered, but the
      // interrupted call is terminalized into history here, so it also has to
      // reach the wire — one announce and one failure for it, and none for the
      // exposed sibling, which is complete and so never enters that branch.
      assertEquals(
        body.match(
          /"type":"tool-input-start","toolCallId":"truncated-agent-after-exposure"/g,
        )?.length ?? 0,
        1,
      );
      assertEquals(
        body.match(
          /"type":"tool-output-error","toolCallId":"truncated-agent-after-exposure"/g,
        )?.length ?? 0,
        1,
      );
      assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 1);
      assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
      assertEquals(body.includes("Unexpected recovery."), false);
    }
  });

  it("surfaces a truncated local tool call when maxSteps exhaustion ends the run", async () => {
    // #3737. Recovery is declined here because the step budget is spent, not
    // because reasoning was exposed, so the flush #3735 added never runs. The
    // run terminalizes the truncated call into history either way, so the wire
    // has to carry the same failure — otherwise the stream ends with no text,
    // no tool call and no error.
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/truncated-at-max-steps",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "issue3737-committed",
                toolName: "issue3737_probe",
                input: '{"revision":"first"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }
        return {
          stream: runtimeStream([
            {
              type: "tool-input-start",
              id: "issue3737-truncated",
              toolName: "issue3737_probe",
            },
            {
              type: "tool-input-delta",
              id: "issue3737-truncated",
              delta: '{"revision":"trunc',
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const probeTool = tool({
      id: "issue3737_probe",
      description: "Apply a revision",
      inputSchema: defineSchema((v) => v.object({ revision: v.string() }))(),
      execute: async ({ revision }) => ({ revision }),
    });
    const assistant = eagerAgent({
      model: "hosted/truncated-at-max-steps",
      system: "Exhaust the step budget on a truncated tool call.",
      tools: { issue3737_probe: probeTool },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Apply both revisions",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    // The truncated call must be announced so its failure card has something
    // to render against.
    assertEquals(
      body.match(
        /"type":"tool-input-start","toolCallId":"issue3737-truncated"/g,
      )?.length ?? 0,
      1,
    );
    // Exactly one failure event on the wire for it — never a tool-input-error
    // alongside the tool-output-error.
    assertEquals(
      body.match(/"type":"tool-output-error","toolCallId":"issue3737-truncated"/g)?.length ?? 0,
      1,
    );
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
    assertEquals(
      body.includes(
        'Stream terminated before tool-call event fired for \\"issue3737_probe\\"',
      ),
      true,
    );
    assertExists(finishedResponse);
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => [toolCall.id, toolCall.status]),
      [
        ["issue3737-committed", "completed"],
        ["issue3737-truncated", "error"],
      ],
    );
  });

  it("does not report stale text when an ordinary tool-only step exhausts maxSteps", async () => {
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/tool-only-max-steps",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        return {
          stream: runtimeStream([
            ...(callCount === 1
              ? [{ type: "text-delta" as const, text: "Starting the work." }]
              : []),
            {
              type: "tool-call",
              toolCallId: `ordinary-tool-${callCount}`,
              toolName: "ordinary_tool",
              input: "{}",
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const ordinaryTool = tool({
      id: "ordinary_tool",
      description: "Complete one ordinary step",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ ok: true }),
    });
    const assistant = eagerAgent({
      model: "hosted/tool-only-max-steps",
      system: "Complete two ordinary tool steps.",
      tools: { ordinary_tool: ordinaryTool },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Complete both steps",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    await response.text();

    assertEquals(callCount, 2);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "");
  });

  it("recovers a placeholder after assistant text only once", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/text-placeholder-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Created the Outlook " },
              { type: "text-delta", text: "assistant." },
              {
                type: "tool-input-start",
                id: "toolu_repeated_placeholder",
                toolName: "studio_suggestions",
              },
              { type: "tool-input-delta", id: "toolu_repeated_placeholder", delta: "{}" },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }
        if (callCount > 2) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Unexpected second recovery." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Created the Outlook assistant." },
            {
              type: "tool-input-start",
              id: "toolu_placeholder_after_text",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_placeholder_after_text", delta: "{}" },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/text-placeholder-stream",
      system: "Placeholder recovery regression test",
      maxSteps: 4,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({
      input: "Create an Outlook assistant",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await response.text();

    assertEquals(callCount, 2);
    assertEquals(toolResults, []);
    assertEquals(body.match(/Created the Outlook assistant\./g)?.length ?? 0, 1);
    // #3737. The step-1 placeholder is still off the wire: recovery ran, so it
    // is provisional and gets re-asked. The step-2 placeholder is terminal —
    // the assertions below show it kept in the assistant message with a
    // matching tool-result error and an errored entry in `toolCalls`, so
    // holding it back from the wire made the persisted history and the live
    // stream disagree. One announce and one failure, for the terminal one only.
    assertEquals(
      body.match(
        /"type":"tool-input-start","toolCallId":"toolu_repeated_placeholder"/g,
      )?.length ?? 0,
      1,
    );
    assertEquals(
      body.match(
        /"type":"tool-input-start","toolCallId":"toolu_placeholder_after_text"/g,
      )?.length ?? 0,
      0,
    );
    assertEquals(
      body.match(/"type":"tool-output-error","toolCallId":"toolu_repeated_placeholder"/g)?.length ??
        0,
      1,
    );
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 1);
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
    assertEquals(body.includes("Unexpected second recovery."), false);
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Created the Outlook assistant.");
    assertEquals(
      completedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Created the Outlook assistant."],
    );
    const placeholderPart = completedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) => "toolCallId" in part && part.toolCallId === "toolu_placeholder_after_text");
    assertExists(placeholderPart);
    const placeholderError = completedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        part.type === "tool-result" &&
        part.toolCallId === "toolu_placeholder_after_text"
      );
    assertExists(placeholderError);
    assertEquals((placeholderError as { result: unknown }).result, {
      error:
        'Stream terminated before tool-call event fired for "studio_suggestions". Received 2 chars of partial tool-input deltas.',
    });
    assertEquals(
      completedResponse.toolCalls.some((toolCall) =>
        toolCall.id === "toolu_placeholder_after_text"
      ),
      false,
    );
    const repeatedPlaceholderError = completedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        part.type === "tool-result" &&
        part.toolCallId === "toolu_repeated_placeholder"
      );
    assertExists(repeatedPlaceholderError);
    assertEquals((repeatedPlaceholderError as { result: unknown }).result, {
      error:
        'Stream terminated before tool-call event fired for "studio_suggestions". Received 2 chars of partial tool-input deltas.',
    });
    const repeatedPlaceholderPart = completedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        part.type === "tool-studio_suggestions" &&
        part.toolCallId === "toolu_repeated_placeholder"
      );
    assertExists(repeatedPlaceholderPart);
    const repeatedToolCall = completedResponse.toolCalls.find((toolCall) =>
      toolCall.id === "toolu_repeated_placeholder"
    );
    assertExists(repeatedToolCall);
    assertEquals(repeatedToolCall.status, "error");
  });

  it("keeps prior text while interrupted recovery returns only a tool call", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let executionCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        executionCount++;
        return { suggestions: [] };
      },
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/tool-only-recovery",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Preparing the Studio suggestions." },
              {
                type: "tool-input-start",
                id: "toolu_tool_only_placeholder",
                toolName: "studio_suggestions",
              },
              { type: "tool-input-delta", id: "toolu_tool_only_placeholder", delta: "{}" },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }
        return {
          stream: runtimeStream([
            {
              type: "tool-call",
              toolCallId: "toolu_reconstructed_suggestions",
              toolName: "studio_suggestions",
              input: "{}",
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/tool-only-recovery",
      system: "Recover an interrupted local placeholder once.",
      tools: { studio_suggestions: studioSuggestions },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Prepare Studio suggestions",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    assertEquals(executionCount, 1);
    assertEquals(body.match(/Preparing the Studio suggestions\./g)?.length ?? 0, 1);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "Preparing the Studio suggestions.");
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        status: toolCall.status,
      })),
      [{ id: "toolu_reconstructed_suggestions", status: "completed" }],
    );
    const interruptedPlaceholderPart = finishedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) => "toolCallId" in part && part.toolCallId === "toolu_tool_only_placeholder");
    assertExists(interruptedPlaceholderPart);
    const interruptedPlaceholderError = finishedResponse.messages
      .flatMap((message) => message.parts)
      .find((part) =>
        part.type === "tool-result" &&
        part.toolCallId === "toolu_tool_only_placeholder"
      );
    assertExists(interruptedPlaceholderError);
    assertEquals((interruptedPlaceholderError as { result: unknown }).result, {
      error:
        'Stream terminated before tool-call event fired for "studio_suggestions". Received 2 chars of partial tool-input deltas.',
    });
    const recoveredToolCall = finishedResponse.toolCalls.find((toolCall) =>
      toolCall.id === "toolu_reconstructed_suggestions"
    );
    assertExists(recoveredToolCall);
    assertEquals(recoveredToolCall.status, "completed");
  });

  it("delivers distinct terminal text from placeholder recovery", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let observedRecoveryChunkBeforeFinish = false;
    let observedRecoveryStreamBeforeFinish = false;
    const chunks: string[] = [];
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/distinct-placeholder-recovery-text",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          let recoveryPart = 0;
          return {
            stream: new ReadableStream<unknown>({
              async pull(controller) {
                recoveryPart++;
                if (recoveryPart === 1) {
                  controller.enqueue({ type: "text-delta", text: "Recovered final answer." });
                  return;
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
                observedRecoveryChunkBeforeFinish = chunks.includes("Recovered final answer.");
                observedRecoveryStreamBeforeFinish = observedRecoveryStreamBeforeFinish ||
                  recoveryStreamObserved;
                controller.enqueue({ type: "finish", finishReason: "stop" });
                controller.close();
              },
            }),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Initial partial answer." },
            {
              type: "tool-input-start",
              id: "toolu_distinct_recovery",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_distinct_recovery", delta: "{}" },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/distinct-placeholder-recovery-text",
      system: "Distinct placeholder recovery text regression test",
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
    });

    let recoveryStreamObserved = false;
    const response = (await assistant.stream({
      input: "Create an Outlook assistant",
      onChunk: (chunk) => chunks.push(chunk),
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes("Recovered final answer.")) {
        recoveryStreamObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedRecoveryChunkBeforeFinish, true);
    assertEquals(observedRecoveryStreamBeforeFinish, true);
    assertEquals(body.match(/Initial partial answer\./g)?.length ?? 0, 1);
    assertEquals(body.match(/Recovered final answer\./g)?.length ?? 0, 1);
    assertEquals(chunks, ["Initial partial answer.", "Recovered final answer."]);
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Recovered final answer.");
    assertEquals(
      completedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Initial partial answer.", "Recovered final answer."],
    );
  });

  it("streams distinct recovery text before finish without an onChunk callback", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let observedRecoveryStreamBeforeFinish = false;
    let recoveryStreamObserved = false;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/distinct-placeholder-recovery-without-callback",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          let recoveryPart = 0;
          return {
            stream: new ReadableStream<unknown>({
              async pull(controller) {
                recoveryPart++;
                if (recoveryPart === 1) {
                  controller.enqueue({ type: "text-delta", text: "Recovered final answer." });
                  return;
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
                observedRecoveryStreamBeforeFinish = recoveryStreamObserved;
                controller.enqueue({ type: "finish", finishReason: "stop" });
                controller.close();
              },
            }),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Initial partial answer." },
            {
              type: "tool-input-start",
              id: "toolu_distinct_recovery_without_callback",
              toolName: "studio_suggestions",
            },
            {
              type: "tool-input-delta",
              id: "toolu_distinct_recovery_without_callback",
              delta: "{}",
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/distinct-placeholder-recovery-without-callback",
      system: "Distinct placeholder recovery response stream regression test",
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
    });

    const response = (await assistant.stream({
      input: "Create an Outlook assistant",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes("Recovered final answer.")) {
        recoveryStreamObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedRecoveryStreamBeforeFinish, true);
    assertEquals(body.match(/Initial partial answer\./g)?.length ?? 0, 1);
    assertEquals(body.match(/Recovered final answer\./g)?.length ?? 0, 1);
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Recovered final answer.");
  });

  it("delivers only the new suffix when recovery extends prior text", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let observedRecoverySuffixBeforeFinish = false;
    let observedRecoverySuffixStreamBeforeFinish = false;
    const chunks: string[] = [];
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/prefix-placeholder-recovery-text",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          const recoveryParts = [
            { type: "text-delta", text: "Created the " },
            { type: "text-delta", text: "assistant. It is ready." },
          ];
          let recoveryPart = 0;
          return {
            stream: new ReadableStream<unknown>({
              async pull(controller) {
                if (recoveryPart < recoveryParts.length) {
                  controller.enqueue(recoveryParts[recoveryPart++]);
                  return;
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
                observedRecoverySuffixBeforeFinish = chunks.includes(" It is ready.");
                observedRecoverySuffixStreamBeforeFinish =
                  observedRecoverySuffixStreamBeforeFinish || recoverySuffixStreamObserved;
                controller.enqueue({ type: "finish", finishReason: "stop" });
                controller.close();
              },
            }),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Created the assistant." },
            {
              type: "tool-input-start",
              id: "toolu_prefix_recovery",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_prefix_recovery", delta: "{}" },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/prefix-placeholder-recovery-text",
      system: "Prefix placeholder recovery text regression test",
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
    });

    let recoverySuffixStreamObserved = false;
    const response = (await assistant.stream({
      input: "Create an assistant",
      onChunk: (chunk) => chunks.push(chunk),
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes(" It is ready.")) {
        recoverySuffixStreamObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedRecoverySuffixBeforeFinish, true);
    assertEquals(observedRecoverySuffixStreamBeforeFinish, true);
    assertEquals(body.match(/Created the assistant\./g)?.length ?? 0, 1);
    assertEquals(body.match(/ It is ready\./g)?.length ?? 0, 1);
    assertEquals(chunks, ["Created the assistant.", " It is ready."]);
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Created the assistant. It is ready.");
    assertEquals(
      completedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Created the assistant.", " It is ready."],
    );
  });

  it("starts a replacement stream segment when recovery diverges after a shared prefix", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const chunks: string[] = [];
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/divergent-prefix-placeholder-recovery-text",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Created the " },
              { type: "text-delta", text: "workflow." },
              { type: "reasoning-delta", id: "recovery-reasoning", delta: "Check result." },
              { type: "reasoning-end", id: "recovery-reasoning" },
              { type: "text-delta", text: " It is ready." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Created the assistant." },
            {
              type: "tool-input-start",
              id: "toolu_divergent_prefix_recovery",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_divergent_prefix_recovery", delta: "{}" },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/divergent-prefix-placeholder-recovery-text",
      system: "Divergent prefix placeholder recovery text regression test",
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
    });

    const body = await (await assistant.stream({
      input: "Create an assistant",
      onChunk: (chunk) => chunks.push(chunk),
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    assertEquals(body.match(/Created the assistant\./g)?.length ?? 0, 1);
    assertEquals(body.includes(":step:1:recovery"), true);
    assertEquals(body.includes('"type":"text-start","id":"text-'), true);
    assertEquals(body.includes(':step:1:recovery"}'), true);
    assertEquals(
      body.includes(':step:1:recovery","delta":"Created the "'),
      true,
    );
    assertEquals(
      body.includes(':step:1:recovery","delta":"workflow."'),
      true,
    );
    const recoveryTextStartIds = [...body.matchAll(
      /"type":"text-start","id":"([^"]*:step:1[^"]*)"/g,
    )].map((match) => match[1]);
    assertEquals(recoveryTextStartIds.length, 2);
    assertEquals(new Set(recoveryTextStartIds).size, 2);
    assertEquals(chunks, [
      "Created the assistant.",
      "Created the ",
      "workflow.",
      " It is ready.",
    ]);
    assertEquals(chunks.slice(1).join(""), "Created the workflow. It is ready.");
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Created the workflow. It is ready.");
    assertEquals(
      completedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Created the assistant.", "Created the workflow. It is ready."],
    );
  });

  it("suppresses a shorter replay prefix without shortening the final text", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const chunks: string[] = [];
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/short-prefix-placeholder-recovery-text",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 2) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Created the " },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Created the assistant." },
            {
              type: "tool-input-start",
              id: "toolu_short_prefix_recovery",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_short_prefix_recovery", delta: "{}" },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "hosted/short-prefix-placeholder-recovery-text",
      system: "Short prefix placeholder recovery text regression test",
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
    });

    const body = await (await assistant.stream({
      input: "Create an assistant",
      onChunk: (chunk) => chunks.push(chunk),
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    assertEquals(body.match(/Created the /g)?.length ?? 0, 1);
    assertEquals(chunks, ["Created the assistant."]);
    const completedResponse = finishedResponse as AgentResponse | undefined;
    assertExists(completedResponse);
    assertEquals(completedResponse.text, "Created the assistant.");
    assertEquals(
      completedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Created the assistant."],
    );
  });

  it("stops after distinct recovery text with a finalized provider result", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Checking the requested update." },
              {
                type: "tool-input-start",
                id: "toolu_interrupted_suggestions",
                toolName: "studio_suggestions",
              },
              { type: "tool-input-delta", id: "toolu_interrupted_suggestions", delta: "{}" },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }
        if (callCount === 2) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "The provider lookup completed." },
              {
                type: "tool-call",
                toolCallId: "provider-search",
                toolName: "web_search",
                input: '{"query":"status"}',
                providerExecuted: true,
              },
              {
                type: "tool-result",
                toolCallId: "provider-search",
                toolName: "web_search",
                output: { results: [] },
                providerExecuted: true,
              },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }
        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Unexpected continuation." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Recover an interrupted local placeholder once.",
      tools: { studio_suggestions: studioSuggestions },
      providerTools: ["web_search"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Check the update",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    assertEquals(body.includes("Checking the requested update."), true);
    assertEquals(body.includes("The provider lookup completed."), true);
    assertEquals(body.includes("Unexpected continuation."), false);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "The provider lookup completed.");
    assertEquals(
      finishedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Checking the requested update.", "The provider lookup completed."],
    );
  });

  it("streams provider events after an exact recovery replay before finish", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let providerEventObserved = false;
    let observedProviderEventBeforeFinish = false;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Checking the requested update." },
              {
                type: "tool-input-start",
                id: "toolu_interrupted_exact_replay",
                toolName: "studio_suggestions",
              },
              {
                type: "tool-input-delta",
                id: "toolu_interrupted_exact_replay",
                delta: "{}",
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        let recoveryPart = 0;
        return {
          stream: new ReadableStream<unknown>({
            async pull(controller) {
              recoveryPart++;
              if (recoveryPart === 1) {
                controller.enqueue({ type: "text-delta", text: "Checking the requested update." });
                return;
              }
              if (recoveryPart === 2) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "provider-search-exact-replay",
                  toolName: "web_search",
                  input: '{"query":"status"}',
                  providerExecuted: true,
                });
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
              observedProviderEventBeforeFinish = providerEventObserved;
              controller.enqueue({
                type: "tool-result",
                toolCallId: "provider-search-exact-replay",
                toolName: "web_search",
                output: { results: [] },
                providerExecuted: true,
              });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Recover an interrupted local placeholder once.",
      tools: { studio_suggestions: studioSuggestions },
      providerTools: ["web_search"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Check the update",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes("provider-search-exact-replay")) {
        providerEventObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedProviderEventBeforeFinish, true);
    assertEquals(body.match(/Checking the requested update\./g)?.length ?? 0, 1);
    assertEquals(body.includes("provider-search-exact-replay"), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "Checking the requested update.");
  });

  it("streams provider events after a partial recovery replay prefix", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let providerEventObserved = false;
    let observedProviderEventBeforeReplayCompleted = false;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Checking the requested update." },
              {
                type: "tool-input-start",
                id: "toolu_interrupted_partial_replay",
                toolName: "studio_suggestions",
              },
              {
                type: "tool-input-delta",
                id: "toolu_interrupted_partial_replay",
                delta: "{}",
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        let recoveryPart = 0;
        return {
          stream: new ReadableStream<unknown>({
            async pull(controller) {
              recoveryPart++;
              if (recoveryPart === 1) {
                controller.enqueue({ type: "text-delta", text: "Checking " });
                return;
              }
              if (recoveryPart === 2) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "provider-search-partial-replay",
                  toolName: "web_search",
                  input: '{"query":"status"}',
                  providerExecuted: true,
                });
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
              observedProviderEventBeforeReplayCompleted = providerEventObserved;
              controller.enqueue({ type: "text-delta", text: "the requested update. Done." });
              controller.enqueue({
                type: "tool-result",
                toolCallId: "provider-search-partial-replay",
                toolName: "web_search",
                output: { results: [] },
                providerExecuted: true,
              });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Partial recovery replay provider event regression test",
      tools: { studio_suggestions: studioSuggestions },
      providerTools: ["web_search"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Check the update",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes("provider-search-partial-replay")) {
        providerEventObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedProviderEventBeforeReplayCompleted, true);
    assertEquals(body.match(/Checking the requested update\./g)?.length ?? 0, 1);
    assertEquals(body.match(/ Done\./g)?.length ?? 0, 1);
    assertEquals(body.includes("provider-search-partial-replay"), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "Checking the requested update. Done.");
    assertEquals(
      finishedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Checking the requested update.", " Done."],
    );
  });

  it("does not replay a retained prefix after a provider-tool text boundary", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const chunks: string[] = [];
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Checking the update." },
              {
                type: "tool-input-start",
                id: "toolu_interrupted_segment_replay",
                toolName: "studio_suggestions",
              },
              {
                type: "tool-input-delta",
                id: "toolu_interrupted_segment_replay",
                delta: "{}",
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "Checking " },
            {
              type: "tool-call",
              toolCallId: "provider-search-segment-replay",
              toolName: "web_search",
              input: '{"query":"status"}',
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "provider-search-segment-replay",
              toolName: "web_search",
              output: { results: [] },
              providerExecuted: true,
            },
            { type: "text-delta", text: "Done." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Text-segment recovery replay regression test",
      tools: { studio_suggestions: studioSuggestions },
      providerTools: ["web_search"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Check the update",
      onChunk: (chunk) => chunks.push(chunk),
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    assertEquals(body.match(/Checking /g)?.length ?? 0, 1);
    assertEquals(body.match(/Done\./g)?.length ?? 0, 1);
    assertEquals(body.indexOf("provider-search-segment-replay") < body.indexOf("Done."), true);
    assertEquals(chunks, ["Checking the update.", "Done."]);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "Checking the update.Done.");
    assertEquals(
      finishedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Checking the update.", "Done."],
    );
  });

  it("does not retry a truncated non-placeholder tool call after exposing reasoning", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        return {
          stream: runtimeStream([
            { type: "reasoning-start", id: "reasoning-before-interruption" },
            {
              type: "reasoning-delta",
              id: "reasoning-before-interruption",
              delta: "Check hidden state.",
            },
            { type: "reasoning-end", id: "reasoning-before-interruption" },
            {
              type: "tool-input-start",
              id: "toolu_interrupted_after_reasoning",
              toolName: "studio_suggestions",
            },
            {
              type: "tool-input-delta",
              id: "toolu_interrupted_after_reasoning",
              delta: '{"suggestions":[',
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Reasoning recovery replay regression test",
      tools: { studio_suggestions: studioSuggestions },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Check before acting",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 1);
    assertEquals(body.match(/Check hidden state\./g)?.length ?? 0, 1);
    assertExists(finishedResponse);
    assertEquals(
      finishedResponse.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "reasoning")
        .flatMap((part) => "text" in part && typeof part.text === "string" ? [part.text] : []),
      ["Check hidden state."],
    );

    // Terminal state. Declining recovery ends the run here, so the truncated
    // call has to reach the client as a failed tool card: its tool-input-start
    // was buffered awaiting a commit that never came, and without flushing it
    // the stream would stop after the reasoning block with nothing rendered.
    assertEquals(body.match(/"type":"message-finish"/g)?.length ?? 0, 1);
    assertEquals(body.includes('"finishReason":"tool-calls"'), true);
    assertEquals(body.match(/"type":"tool-input-start"/g)?.length ?? 0, 1);
    assertEquals(body.match(/"type":"tool-input-available"/g)?.length ?? 0, 0);
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 1);
    // Both terminal error events key off `inputAnnounced`, and only statement
    // order keeps the incomplete-tool loop from firing before the announce.
    // Exactly one failure event must reach the client, never two.
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
    assertEquals(
      body.includes(
        'Stream terminated before tool-call event fired for \\"studio_suggestions\\"',
      ),
      true,
    );
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => [toolCall.name, toolCall.status]),
      [["studio_suggestions", "error"]],
    );
  });

  it("announces a truncated delegated remote tool under its namespaced name", async () => {
    // The announce on the declined-recovery path is only reachable when
    // `tool-call` never fired — that event sets `inputAvailable: true`, which
    // makes `recordIncompleteLocalToolError` return at its guard. So no later
    // event can supersede the name, and the name on the card must equal both
    // the one the provider streamed and the one written to history.
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const gmailSource: RemoteToolSource = {
      id: "gmail",
      listTools: () =>
        Promise.resolve([{
          name: "gmail__list_emails",
          description: "List Gmail messages",
          parameters: { type: "object", properties: {} },
        }]),
      executeTool: () => Promise.resolve({ messages: [] }),
    };
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount > 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Unexpected recovery." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "reasoning-start", id: "reasoning-before-remote" },
            {
              type: "reasoning-delta",
              id: "reasoning-before-remote",
              delta: "Check the inbox first.",
            },
            { type: "reasoning-end", id: "reasoning-before-remote" },
            {
              type: "tool-input-start",
              id: "toolu_remote_truncated",
              toolName: "gmail__list_emails",
            },
            {
              type: "tool-input-delta",
              id: "toolu_remote_truncated",
              delta: '{"query":"is:unread',
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent(
      {
        model: "anthropic/claude-sonnet-4-6",
        system: "Remote tool truncation regression test",
        tools: { gmail__list_emails: true },
        __vfRemoteToolSources: [gmailSource],
        __vfAllowedRemoteTools: ["gmail__list_emails"],
        maxSteps: 3,
        resolveModelTransport: async () => ({ model }),
      } as AgentConfig & RuntimeRemoteToolConfig,
    );

    const body = await (await assistant.stream({
      input: "Summarize my inbox",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 1);
    assertEquals(body.includes("Unexpected recovery."), false);
    assertExists(finishedResponse);

    // The card is announced under the exact namespaced name the provider sent.
    // No bare `list_emails`, and no placeholder for an unresolved namespace.
    assertEquals(body.match(/"type":"tool-input-start"/g)?.length ?? 0, 1);
    assertEquals(
      body.match(
        /"type":"tool-input-start","toolCallId":"toolu_remote_truncated","toolName":"gmail__list_emails"/g,
      )
        ?.length ?? 0,
      1,
    );
    assertEquals(body.match(/"toolName":"list_emails"/g)?.length ?? 0, 0);
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 1);
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
    assertEquals(body.match(/"type":"tool-input-available"/g)?.length ?? 0, 0);

    // The name on the wire matches the name persisted to history, so a reload
    // renders the same tool as the live stream did.
    const persistedToolNames = finishedResponse.messages
      .flatMap((message) => message.parts)
      .flatMap((part) =>
        "toolCallId" in part && part.toolCallId === "toolu_remote_truncated" &&
          "toolName" in part && typeof part.toolName === "string"
          ? [part.toolName]
          : []
      );
    assertEquals(persistedToolNames.every((name) => name === "gmail__list_emails"), true);
    assertEquals(persistedToolNames.length > 0, true);
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => [toolCall.name, toolCall.status]),
      [["gmail__list_emails", "error"]],
    );
  });

  it("announces the finalized name when tool-call supersedes the buffered one", async () => {
    // The buffered-name concern in the abstract: a `tool-call` carrying a
    // different name than its `tool-input-start`. It is handled where the
    // rename happens — `tool-call` announces the final name itself — and it
    // also sets `inputAvailable: true`, so the terminal announce on the
    // declined-recovery path can never see a superseded name.
    let callCount = 0;
    const renamed = tool({
      id: "summarize_inbox",
      description: "Summarize the inbox",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ messages: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount > 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Done." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "reasoning-start", id: "reasoning-before-rename" },
            {
              type: "reasoning-delta",
              id: "reasoning-before-rename",
              delta: "Check the inbox.",
            },
            { type: "reasoning-end", id: "reasoning-before-rename" },
            {
              type: "tool-input-start",
              id: "toolu_renamed",
              toolName: "list_emails",
            },
            { type: "tool-input-delta", id: "toolu_renamed", delta: "{}" },
            {
              type: "tool-call",
              toolCallId: "toolu_renamed",
              toolName: "summarize_inbox",
              input: "{}",
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Tool rename regression test",
      tools: { summarize_inbox: renamed },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({ input: "Summarize my inbox" }))
      .toDataStreamResponse().text();

    // Announced once, under the finalized name, by the `tool-call` branch.
    assertEquals(body.match(/"type":"tool-input-start"/g)?.length ?? 0, 1);
    assertEquals(
      body.match(
        /"type":"tool-input-start","toolCallId":"toolu_renamed","toolName":"summarize_inbox"/g,
      )
        ?.length ?? 0,
      1,
    );
    assertEquals(body.match(/"toolName":"list_emails"/g)?.length ?? 0, 0);
    // Finalized, so it is not an incomplete call: the terminal announce path
    // is not reached and no failure is fabricated for it.
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 0);
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
  });

  it("preserves a bare placeholder tool call when reasoning blocks recovery", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount > 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Unexpected recovery." },
              { type: "finish", finishReason: "stop" },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "reasoning-start", id: "reasoning-before-placeholder" },
            {
              type: "reasoning-delta",
              id: "reasoning-before-placeholder",
              delta: "Plan the suggestions.",
            },
            { type: "reasoning-end", id: "reasoning-before-placeholder" },
            { type: "text-delta", text: "Created the Outlook assistant." },
            {
              type: "tool-input-start",
              id: "toolu_placeholder_after_reasoning",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_placeholder_after_reasoning", delta: "{}" },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Reasoning recovery placeholder regression test",
      tools: { studio_suggestions: studioSuggestions },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const body = await (await assistant.stream({
      input: "Create an Outlook assistant",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse().text();

    assertEquals(callCount, 1);
    assertEquals(body.includes("Unexpected recovery."), false);
    assertExists(finishedResponse);

    // A bare `{}` placeholder is normally dropped from the assistant message
    // when substantive text accompanies it. Terminalizing the step passes
    // `preserveRecoverablePlaceholderToolCalls`, so the call and its error are
    // kept in history and go back to the model on the next turn — the same
    // outcome as maxSteps exhaustion.
    const assistantParts = finishedResponse.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts);
    assertEquals(
      assistantParts.filter((part) => part.type === "reasoning")
        .flatMap((part) => "text" in part && typeof part.text === "string" ? [part.text] : []),
      ["Plan the suggestions."],
    );
    assertEquals(
      assistantParts.flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []),
      ["Created the Outlook assistant."],
    );
    assertExists(
      assistantParts.find((part) =>
        "toolCallId" in part && part.toolCallId === "toolu_placeholder_after_reasoning"
      ),
    );
    assertEquals(
      finishedResponse.toolCalls.map((toolCall) => [toolCall.name, toolCall.status]),
      [["studio_suggestions", "error"]],
    );
    assertEquals(
      finishedResponse.messages
        .flatMap((message) => message.parts)
        .filter((part) =>
          part.type === "tool-result" && "toolCallId" in part &&
          part.toolCallId === "toolu_placeholder_after_reasoning"
        ).length,
      1,
    );
    assertEquals(body.match(/"type":"tool-input-start"/g)?.length ?? 0, 1);
    assertEquals(body.match(/"type":"tool-output-error"/g)?.length ?? 0, 1);
    assertEquals(body.match(/"type":"tool-input-error"/g)?.length ?? 0, 0);
  });

  it("streams provider events before recovery replay text begins", async () => {
    let finishedResponse: AgentResponse | undefined;
    let callCount = 0;
    let providerEventObserved = false;
    let observedProviderEventBeforeReplay = false;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              { type: "text-delta", text: "Checking the requested update." },
              {
                type: "tool-input-start",
                id: "toolu_interrupted_provider_first",
                toolName: "studio_suggestions",
              },
              {
                type: "tool-input-delta",
                id: "toolu_interrupted_provider_first",
                delta: "{}",
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        let recoveryPart = 0;
        return {
          stream: new ReadableStream<unknown>({
            async pull(controller) {
              recoveryPart++;
              if (recoveryPart === 1) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "provider-search-before-replay",
                  toolName: "web_search",
                  input: '{"query":"status"}',
                  providerExecuted: true,
                });
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 0));
              observedProviderEventBeforeReplay = providerEventObserved;
              controller.enqueue({ type: "text-delta", text: "Checking the requested update." });
              controller.enqueue({
                type: "tool-result",
                toolCallId: "provider-search-before-replay",
                toolName: "web_search",
                output: { results: [] },
                providerExecuted: true,
              });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    };

    const assistant = eagerAgent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Recover an interrupted local placeholder once.",
      tools: { studio_suggestions: studioSuggestions },
      providerTools: ["web_search"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Check the update",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const body = await readResponseBody(response, (text) => {
      if (text.includes("provider-search-before-replay")) {
        providerEventObserved = true;
      }
    });

    assertEquals(callCount, 2);
    assertEquals(observedProviderEventBeforeReplay, true);
    assertEquals(body.match(/Checking the requested update\./g)?.length ?? 0, 1);
    assertEquals(body.includes("provider-search-before-replay"), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.text, "Checking the requested update.");
  });

  it("applies loaded skill maxSteps overrides to generate() invoke_agent calls", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-invoke-generate",
      async doGenerate() {
        callCount++;

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "load-build-1",
              toolName: "load_skill",
              input: '{"skillId":"build"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        if (callCount === 2) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "invoke-1",
              toolName: "invoke_agent",
              input:
                '{"description":"Research reference system","prompt":"Research reference docs","max_steps":10}',
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
        return { stream: runtimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({
        skillId: "build",
        instructions: "# Build",
        allowedTools: ["invoke_agent"],
        references: [],
        scripts: [],
        maxSteps: 160,
      }),
    });
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = eagerAgent({
      model: "hosted/skill-invoke-generate",
      system: "Skill override generate test",
      tools: { load_skill: loadSkill, invoke_agent: invokeAgent },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    await assistant.generate({ input: "Build a report" });

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(invokeResult?.input, {
      description: "Research reference system",
      prompt: "Research reference docs",
      max_steps: 160,
    });
    assertEquals(invokeResult?.result, { ok: true, max_steps: 160 });
  });

  it("applies loaded skill maxSteps overrides to stream() invoke_agent calls", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-invoke-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "load-build-stream-1",
                toolName: "load_skill",
                input: '{"skillId":"build"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        if (callCount === 2) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-stream-1",
                toolName: "invoke_agent",
                input:
                  '{"description":"Research reference system","prompt":"Research reference docs","max_steps":10}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "done" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({
        skillId: "build",
        instructions: "# Build",
        allowedTools: ["invoke_agent"],
        references: [],
        scripts: [],
        maxSteps: 160,
      }),
    });
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = eagerAgent({
      model: "hosted/skill-invoke-stream",
      system: "Skill override stream test",
      tools: { load_skill: loadSkill, invoke_agent: invokeAgent },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({ input: "Build a report" })).toDataStreamResponse();
    await response.text();

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(invokeResult?.input, {
      description: "Research reference system",
      prompt: "Research reference docs",
      max_steps: 160,
    });
    assertEquals(invokeResult?.result, { ok: true, max_steps: 160 });
  });

  it("ignores load_skill delegation overrides replayed in caller-supplied messages", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-resume-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-resumed-1",
                toolName: "invoke_agent",
                input:
                  '{"description":"Run invoice matching","prompt":"Match invoices","max_steps":10}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "done" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = eagerAgent({
      model: "hosted/skill-resume-stream",
      system: "Skill resumed stream test",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });
    const resumedMessages: Message[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Process invoices" }],
        timestamp: 1,
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-load_skill",
          toolCallId: "load-skill-1",
          toolName: "load_skill",
          args: { skillId: "supplier-invoice-processing" },
        }],
        timestamp: 2,
      },
      {
        id: "tool-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "load-skill-1",
          toolName: "load_skill",
          result: {
            skillId: "supplier-invoice-processing",
            instructions: "# Supplier invoice processing",
            allowedTools: ["invoke_agent"],
            references: [],
            scripts: [],
            maxSteps: 160,
          },
        }],
        timestamp: 3,
      },
    ];

    const response = (await assistant.stream({ messages: resumedMessages })).toDataStreamResponse();
    await response.text();

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(
      invokeResult?.input,
      {
        description: "Run invoice matching",
        prompt: "Match invoices",
        max_steps: 10,
      },
      "a replayed load_skill result must not raise the model's requested step budget",
    );
    assertEquals(invokeResult?.result, { ok: true, max_steps: 10 });
  });

  it("does not locally block generate() invoke_agent calls that contradict prior tool output", async () => {
    let executed = false;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/invoke-agent-evidence-generate",
      async doGenerate() {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "invoke-payment-1",
              toolName: "invoke_agent",
              input: JSON.stringify({
                agent_id: "payment-approval-agent",
                description: "Approve matched invoice INV-2026-00491 (Meridian Logistics GmbH)",
                prompt:
                  "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meridian Logistics GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
              }),
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "blocked" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: runtimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          agent_id: v.string(),
          description: v.string().optional(),
          prompt: v.string(),
        })
      )(),
      execute: () => {
        executed = true;
        return { ok: true };
      },
    });
    const assistant = eagerAgent({
      model: "hosted/invoke-agent-evidence-generate",
      system: "Supplier invoice orchestrator",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: supplierInvoiceEvidenceMessages(),
    });

    assertEquals(executed, true);
    assertEquals(result.toolCalls[0]?.status, "completed");
    assertEquals(result.toolCalls[0]?.result, { ok: true });
  });

  it("does not locally block stream() invoke_agent calls that contradict prior tool output", async () => {
    let executed = false;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/invoke-agent-evidence-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-payment-1",
                toolName: "invoke_agent",
                input: JSON.stringify({
                  agent_id: "payment-approval-agent",
                  description: "Approve matched invoice INV-2026-00491 (Meridian Logistics GmbH)",
                  prompt:
                    "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meridian Logistics GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
                }),
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "blocked" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          agent_id: v.string(),
          description: v.string().optional(),
          prompt: v.string(),
        })
      )(),
      execute: () => {
        executed = true;
        return { ok: true };
      },
    });
    const assistant = eagerAgent({
      model: "hosted/invoke-agent-evidence-stream",
      system: "Supplier invoice orchestrator",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      messages: supplierInvoiceEvidenceMessages(),
    })).toDataStreamResponse();
    const body = await response.text();

    assertEquals(executed, true);
    assertEquals(body.includes('INV-2026-00491 supplier is \\"Meyer Papier GmbH\\"'), false);
    assertEquals(body.includes("Meridian Logistics GmbH"), true);
  });

  it("refreshes system and context at step boundaries for generate()", async () => {
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    const inspectedContexts: Array<Record<string, unknown> | undefined> = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-generate",
      async doGenerate(options: unknown) {
        callCount++;
        observedSystems.push(systemPromptOf(options));

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "switch-1",
              toolName: "switch_project",
              input: '{"projectId":"project-b"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        if (callCount === 2) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "inspect-1",
              toolName: "inspect_context",
              input: "{}",
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
        return {
          stream: runtimeStream([{
            type: "finish",
            finishReason: "stop",
          }]),
        };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: defineSchema((v) => v.object({ projectId: v.string() }))(),
      execute: async ({ projectId }) => ({ projectId }),
    });

    const inspectContext = tool({
      id: "inspect_context",
      description: "Inspect the current runtime context",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async (_input, context) => {
        inspectedContexts.push(context as Record<string, unknown> | undefined);
        return {
          projectId: context?.projectId,
          steeringRevision: context?.steeringRevision,
        };
      },
    });

    const assistant = eagerAgent({
      model: "hosted/runtime-refresh-generate",
      system: "Base system prompt",
      tools: {
        switch_project: switchProject,
        inspect_context: inspectContext,
      },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed system prompt",
          context: {
            projectId: "project-b",
            steeringRevision: 1,
          },
        };
      },
    });

    const result = await assistant.generate({
      input: "Switch to project b and inspect the active context",
      context: { projectId: "project-a" },
    });

    assertEquals(result.text, "done");
    assertEquals(runtimeRequests.map((request) => request.step), [0, 1, 2]);
    assertEquals(observedSystems.map((system) => system.split("\n\n<runtime_context>")[0]), [
      "Base system prompt",
      "Refreshed system prompt",
      "Refreshed system prompt",
    ]);

    const secondRequest = runtimeRequests[1];
    assertExists(secondRequest);
    assertEquals(secondRequest.context, { projectId: "project-a" });
    assertEquals(
      secondRequest.messages.some((message) =>
        message.role === "tool" &&
        message.parts.some((part) =>
          part.type === "tool-result" &&
          part.toolCallId === "switch-1" &&
          part.toolName === "switch_project"
        )
      ),
      true,
    );

    assertEquals(inspectedContexts.length, 1);
    assertEquals(inspectedContexts[0]?.projectId, "project-b");
    assertEquals(inspectedContexts[0]?.steeringRevision, 1);
  });

  it("refreshes the streaming system prompt between hosted run steps", async () => {
    using time = new FakeTime(new Date("2026-07-19T07:30:00.000Z"));
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedSystems.push(systemPromptOf(options));

        if (callCount === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "switch-stream-1",
                toolName: "switch_project",
                input: '{"projectId":"project-b"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: runtimeStream([
            { type: "text-delta", text: "stream done" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: defineSchema((v) => v.object({ projectId: v.string() }))(),
      execute: async ({ projectId }) => {
        time.tick(24 * 60 * 60 * 1_000);
        return { projectId };
      },
    });

    const assistant = eagerAgent({
      model: "hosted/runtime-refresh-stream",
      system: "Base streaming system prompt",
      tools: { switch_project: switchProject },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed streaming system prompt",
          context: { projectId: "project-b" },
        };
      },
    });

    const response = (await assistant.stream({
      input: "Switch to project b",
      context: { projectId: "project-a" },
    })).toDataStreamResponse();

    const body = await response.text();

    assertEquals(runtimeRequests.map((request) => request.step), [0, 1]);
    assertEquals(observedSystems.map((system) => system.split("\n\n<runtime_context>")[0]), [
      "Base streaming system prompt",
      "Refreshed streaming system prompt",
    ]);
    for (const system of observedSystems) {
      assertEquals(system.match(/<runtime_context>/g)?.length, 1);
      assertEquals(
        system.includes("run_started_at_utc: 2026-07-19T07:30:00.000Z"),
        true,
      );
      assertEquals(system.includes("2026-07-20"), false);
    }
    assertEquals(body.includes("stream done"), true);
  });

  it("keeps the public runtime-state system hook string-compatible", async () => {
    let observedRuntimeSystem: unknown;
    let observedProviderSystem = "";
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-state-string-contract",
      async doGenerate(options) {
        observedProviderSystem = systemPromptOf(options);
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: runtimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const assistant = eagerAgent({
      model: "hosted/runtime-state-string-contract",
      system: "Base system prompt",
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: ({ system }) => {
        observedRuntimeSystem = system;
        return { system: system.replace("Base", "Refreshed") };
      },
    });

    const result = await assistant.generate({ input: "Run once." });

    assertEquals(result.text, "done");
    assertEquals(observedRuntimeSystem, "Base system prompt");
    assertEquals(observedProviderSystem.includes("Refreshed system prompt"), true);
  });

  it("isolates configured structured system messages from runtime-state hook mutations", async () => {
    const opaqueProviderMetadata = () => "opaque";
    const configuredSystem = [{
      role: "system" as const,
      content: "Original structured prompt",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
        custom: { opaqueProviderMetadata },
      },
    }];
    let observedProviderSystem = "";
    let observedProviderPrompt: unknown;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-state-structured-copy",
      async doGenerate(options) {
        observedProviderSystem = systemPromptOf(options);
        observedProviderPrompt = (options as { prompt?: unknown }).prompt;
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: runtimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const assistant = eagerAgent({
      model: "hosted/runtime-state-structured-copy",
      system: configuredSystem,
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: ({ structuredSystem }) => {
        const firstMessage = structuredSystem?.[0] as {
          content?: string;
          providerOptions?: {
            anthropic?: { cacheControl?: { ttl?: string } };
          };
        } | undefined;
        if (firstMessage) {
          firstMessage.content = "Replaced by hook mutation";
          const cacheControl = firstMessage.providerOptions?.anthropic?.cacheControl;
          if (cacheControl) cacheControl.ttl = "1h";
        }
        structuredSystem?.push({ role: "system", content: "Injected by hook mutation" });
        return undefined;
      },
    });

    const result = await assistant.generate({ input: "Run once." });

    assertEquals(result.text, "done");
    assertEquals(configuredSystem, [{
      role: "system",
      content: "Original structured prompt",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
        custom: { opaqueProviderMetadata },
      },
    }]);
    assertEquals(observedProviderSystem.includes("Original structured prompt"), true);
    assertEquals(observedProviderSystem.includes("Replaced by hook mutation"), false);
    assertEquals(observedProviderSystem.includes("Injected by hook mutation"), false);
    const providerPrompt = observedProviderPrompt as Array<{
      role?: string;
      content?: unknown;
      providerOptions?: unknown;
    }>;
    assertEquals(providerPrompt[0]?.providerOptions, {
      anthropic: { cacheControl: { type: "ephemeral" } },
      custom: { opaqueProviderMetadata },
    });
  });

  it("generate and stream permit an advertised active-skill reference after form submission", async () => {
    let generateCalls = 0;
    let streamCalls = 0;
    const generateToolNames: string[][] = [];
    const streamToolNames: string[][] = [];
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/post-form-skill-reference",
      async doGenerate(options: unknown) {
        generateToolNames.push(toolNamesOf(options));
        generateCalls++;
        if (generateCalls === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "read-plan-guide-generate",
              toolName: "load_skill",
              input: JSON.stringify({ skillId: "plan", file: "references/guide.md" }),
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: [{ type: "text", text: "generate done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream(options: unknown) {
        streamToolNames.push(toolNamesOf(options));
        streamCalls++;
        if (streamCalls === 1) {
          return {
            stream: runtimeStream([
              {
                type: "tool-call",
                toolCallId: "read-plan-guide-stream",
                toolName: "load_skill",
                input: JSON.stringify({ skillId: "plan", file: "references/guide.md" }),
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }
        return {
          stream: runtimeStream([
            { type: "text-delta", text: "stream done" },
            {
              type: "finish",
              finishReason: "stop",
              totalUsage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) =>
        v.object({
          skillId: v.string(),
          file: v.string().optional(),
        })
      )(),
      execute: ({ skillId, file }) => ({
        skillId,
        file,
        content: "Guide",
      }),
    });
    const assistant = eagerAgent({
      id: "post-form-skill-reference-agent",
      model: "hosted/post-form-skill-reference",
      system: "Plan assistant",
      skills: true,
      tools: {
        load_skill: loadSkill,
        read_secret: tool({
          id: "read_secret",
          description: "Read a secret outside the active skill policy",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ secret: true }),
        }),
      },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const generated = await assistant.generate({
      input: submittedFormWithActiveSkillMessages(),
    });
    const streamed = await (await assistant.stream({
      messages: submittedFormWithActiveSkillMessages(),
    })).toDataStreamResponse().text();

    assertEquals(generated.toolCalls[0]?.error, undefined);
    assertEquals(generated.toolCalls[0]?.status, "completed");
    assertEquals(generated.toolCalls[0]?.result, {
      skillId: "plan",
      file: "references/guide.md",
      content: "Guide",
    });
    assertEquals(streamed.includes("stream done"), true);
    assertEquals(streamed.includes("Guide"), true);
    // `read_secret` is no longer withheld: a skill's `allowed-tools` is spec
    // pre-approval metadata, not an authorization boundary. `load_skill_reference`
    // stays gated on the skill actually advertising a reference file.
    const expectedToolNames = [
      ["load_skill", "load_skill_reference", "read_secret"],
      ["load_skill", "load_skill_reference", "read_secret"],
    ];
    assertEquals(generateToolNames, expectedToolNames);
    assertEquals(streamToolNames, expectedToolNames);
  });

  it("generate and stream load advertised provider-safe root-owned project skills", async () => {
    const contentsByPath: Record<string, string> = {
      "agents/foo_bar/AGENT.md": "---\nname: foo_bar\ndescription: Owner\n---\nOwner",
      "agents/foo_bar/SKILL.md":
        "---\nname: foo_bar\ndescription: Root underscore skill\n---\nUse foo_bar.",
      "agents/ReleaseNotes/AGENT.md": "---\nname: ReleaseNotes\ndescription: Owner\n---\nOwner",
      "agents/ReleaseNotes/SKILL.md":
        "---\nname: ReleaseNotes\ndescription: Root uppercase skill\n---\nUse ReleaseNotes.",
    };
    const paths = Object.keys(contentsByPath);
    const getProjectFile = ({ path }: { path: string }) =>
      Promise.resolve(
        Object.hasOwn(contentsByPath, path) ? { path, content: contentsByPath[path]! } : null,
      );
    const getProjectFiles = () => Promise.resolve(paths.map((path) => ({ path })));
    const catalog = await getRuntimeProjectSkillCatalog({
      projectId: "project-1",
      authToken: "token",
      builtinSkills: [],
      getProjectFile,
      getProjectFiles,
    });
    const skillSourcePaths = Object.fromEntries(
      catalog.flatMap((skill) => skill.sourcePath ? [[skill.id, skill.sourcePath]] : []),
    );
    const loader = createRuntimeProjectSkillLoader({ getProjectFile, getProjectFiles });
    const projectSkillContext: RuntimeProjectSkillContext = {
      projectId: "project-1",
      authToken: "token",
      skillSourcePaths,
    };
    const loadedIds: string[] = [];
    const loadSkill = tool({
      id: "load_root_owned_skill",
      description: "Load one advertised project skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: async ({ skillId }) => {
        const loaded = await loader.loadProjectSkill(projectSkillContext, skillId);
        if (loaded) loadedIds.push(skillId);
        return loaded;
      },
    });
    let generateCalls = 0;
    let streamCalls = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/provider-safe-root-skills",
      async doGenerate() {
        generateCalls++;
        return {
          content: [{
            type: "tool-call",
            toolCallId: `root-skill-generate-${generateCalls}`,
            toolName: "load_root_owned_skill",
            input: JSON.stringify({ skillId: "foo_bar" }),
          }],
          finishReason: "tool-calls",
        };
      },
      async doStream() {
        streamCalls++;
        return {
          stream: runtimeStream([
            {
              type: "tool-call",
              toolCallId: `root-skill-stream-${streamCalls}`,
              toolName: "load_root_owned_skill",
              input: JSON.stringify({ skillId: "ReleaseNotes" }),
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
        };
      },
    };
    const assistant = eagerAgent({
      id: "provider-safe-root-skill-agent",
      model: "hosted/provider-safe-root-skills",
      system: "Load the advertised skill.",
      skills: true,
      tools: { load_root_owned_skill: loadSkill },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
      resolveRuntimeState: () => ({
        systemPrompt: "Load the advertised skill.",
        context: {
          projectId: "project-1",
          authToken: "token",
          availableSkillIds: catalog.map((skill) => skill.id),
          skillSourcePaths,
        },
      }),
    });

    // Runtime tool discovery fires whenever the run context carries a token, and
    // `apiBaseUrl` falls back to the production API when VERYFRONT_API_BASE_URL is
    // unset. Unmocked, generate() and stream() each POST /integrations/tools/list
    // to api.veryfront.com and the test is at the mercy of a 30s fetch timeout.
    // This test is about project skills, so answer discovery with no tools.
    const { generated, streamed } = await withMockFetch(
      (input) => {
        const url = input instanceof Request ? input.url : String(input);
        // Match the whole pathname, not a substring: a loose test also accepts
        // a neighbouring route like `/integrations/tools/listing`, so a call to
        // the wrong endpoint would be answered with an empty catalogue and the
        // test would still pass. Anchored at the end rather than compared whole
        // because VERYFRONT_API_BASE_URL may carry a path prefix, and the client
        // concatenates base and path (`${baseUrl}${path}`).
        if (!new URL(url).pathname.endsWith("/integrations/tools/list")) {
          throw new Error(`Unexpected network call from a unit test: ${url}`);
        }
        return Promise.resolve(Response.json({ tools: [] }));
      },
      async () => {
        const generated = await assistant.generate({ input: "Load foo_bar" });
        const streamed = await (await assistant.stream({ input: "Load ReleaseNotes" }))
          .toDataStreamResponse().text();
        return { generated, streamed };
      },
    );

    assertEquals(catalog.map((skill) => skill.id), ["ReleaseNotes", "foo_bar"]);
    assertEquals(generated.toolCalls[0]?.status, "completed");
    assertEquals(streamed.includes("Use ReleaseNotes."), true);
    assertEquals(loadedIds, ["foo_bar", "ReleaseNotes"]);
  });
});
