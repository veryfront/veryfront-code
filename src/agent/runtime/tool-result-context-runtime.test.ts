import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent, createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import type { AgentConfig, AgentResponse, Message, MessagePart } from "../types.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import type { ProviderReplayCheckpoint } from "./provider-replay.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";

const LARGE_RESULT = "alpha\n".repeat(80);
const HUGE_EMAIL_RESULT = [
  "From: support@example.com",
  "Subject: Long customer support thread",
  "",
  "The following thread contains the complete customer history.",
  "body=".repeat(20_000),
].join("\n");
const CHECKPOINT_MESSAGE_ID = "checkpointed-assistant";
const CHECKPOINT_SIGNATURE = "signed-thinking-for-replay";

function listRecordsTool(result = LARGE_RESULT) {
  return tool({
    id: "list_records",
    description: "List records",
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => result,
  });
}

function customGetToolResultTool() {
  return tool({
    id: "get_tool_result",
    description: "Custom tool that intentionally collides with the framework reader",
    inputSchema: defineSchema((v) => v.object({ ref: v.string() }))(),
    execute: () => ({ custom: true }),
  });
}

function cappedNoopTools(count: number): Exclude<AgentConfig["tools"], true | undefined> {
  const tools: Exclude<AgentConfig["tools"], true | undefined> = {};
  for (let index = 0; index < count; index++) {
    const id = `tool_${index.toString().padStart(3, "0")}`;
    tools[id] = tool({
      id,
      description: `No-op tool ${index}`,
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true, index }),
    });
  }
  return tools;
}

function checkpointForListRecordsToolCall(): ProviderReplayCheckpoint {
  return {
    version: 1,
    messageId: CHECKPOINT_MESSAGE_ID,
    provider: "anthropic",
    providerBlocks: [
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "thinking",
          thinking: "",
          signature: CHECKPOINT_SIGNATURE,
        },
      },
      {
        type: "provider-block",
        provider: "anthropic",
        block: {
          type: "tool_use",
          id: "call-list",
          name: "list_records",
          input: {},
        },
      },
    ],
    providerBlockPositions: [0, 1],
    providerMessageBlockCounts: [2],
    totalPartCount: 2,
  };
}

function promptFromCall(call: unknown): Array<Record<string, unknown>> {
  const prompt = (call as { prompt?: unknown }).prompt;
  assert(Array.isArray(prompt));
  return prompt as Array<Record<string, unknown>>;
}

function promptMessage(call: unknown, role: string): Record<string, unknown> | undefined {
  return promptFromCall(call).find((message) => message.role === role);
}

function toolNamesFromCall(call: unknown): string[] {
  const tools = (call as { tools?: unknown }).tools;
  if (Array.isArray(tools)) {
    return tools
      .map((entry) => (entry as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();
  }
  return Object.keys((tools as Record<string, unknown> | undefined) ?? {}).sort();
}

function firstToolOutput(call: unknown, toolName: string): unknown {
  for (const message of promptFromCall(call)) {
    if (message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content as Array<Record<string, unknown>>) {
      if (part.toolName === toolName) return part.output;
    }
  }
  return undefined;
}

function firstToolOutputValue(call: unknown, toolName: string): unknown {
  const output = firstToolOutput(call, toolName);
  if (
    output && typeof output === "object" && (output as { type?: unknown }).type === "json" &&
    "value" in output
  ) {
    return (output as { value: unknown }).value;
  }
  return output;
}

function toolResultMessage(response: AgentResponse, toolName: string): Message | undefined {
  return response.messages.find((message) =>
    message.role === "tool" &&
    message.parts.some((part) => part.type === "tool-result" && part.toolName === toolName)
  );
}

function toolResultValue(message: Message | undefined): unknown {
  assertExists(message);
  const part = message.parts.find((candidate) => candidate.type === "tool-result");
  assertExists(part);
  if (!isToolResultPart(part)) {
    throw new Error("expected tool result part");
  }
  return part.result;
}

function isToolResultPart(
  part: MessagePart,
): part is Extract<MessagePart, { type: "tool-result" }> {
  return part.type === "tool-result" && "result" in part;
}

function withoutToolCalling(
  model: ReturnType<typeof scriptedModel>,
): ReturnType<typeof scriptedModel> {
  return Object.assign(model, {
    runtimeCapabilities: { ...model.runtimeCapabilities, toolCalling: false as const },
  });
}

function historicalToolResultMessages(result: string): Message[] {
  return [
    {
      id: "historical-assistant-call",
      role: "assistant",
      parts: [{
        type: "tool-call",
        toolCallId: "historical-call-list",
        toolName: "list_records",
        args: {},
      }],
      timestamp: 1,
    } as Message,
    {
      id: "historical-tool-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "historical-call-list",
        toolName: "list_records",
        result,
      }],
      timestamp: 2,
    } as Message,
    {
      id: "historical-user",
      role: "user",
      parts: [{ type: "text", text: "Continue from the prior result." }],
      timestamp: 3,
    } as Message,
  ];
}

describe("agent runtime tool result context integration", () => {
  it("compacts oversized generate() tool results for the next model call while preserving raw response history", async () => {
    let ref = "";
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        const compactOutput = firstToolOutputValue(options, "list_records") as {
          type?: string;
          ref?: string;
          preview?: string;
        };
        assertEquals(compactOutput.type, "tool_result_reference");
        assertExists(compactOutput.ref);
        ref = compactOutput.ref;
        assert(compactOutput.preview!.length < LARGE_RESULT.length);
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), true);
        return {
          toolCalls: [{
            id: "call-read",
            name: "get_tool_result",
            input: { ref: compactOutput.ref, maxBytes: 1_000 },
          }],
        };
      },
      { text: "done" },
    ], { only: "generate" });

    const assistant = agent({
      model: "hosted/tool-result-context-generate",
      system: "Use tools.",
      skills: [],
      tools: { list_records: listRecordsTool() },
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24, maxSectionBytes: 1_000 },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({ input: "List records then read the full result." });

    assertEquals(response.text, "done");
    assertEquals(toolNamesFromCall(model.calls[0]).includes("get_tool_result"), false);
    assertEquals(toolResultValue(toolResultMessage(response, "list_records")), LARGE_RESULT);
    assertEquals(toolResultValue(toolResultMessage(response, "get_tool_result")), {
      type: "tool_result_section",
      ref,
      toolCallId: "call-list",
      toolName: "list_records",
      totalBytes: LARGE_RESULT.length,
      cursor: "0",
      done: true,
      text: LARGE_RESULT,
      byteLength: LARGE_RESULT.length,
    });
  });

  it("bounds a realistic 100KB tool result under default limits while preserving the raw result", async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        const output = firstToolOutput(options, "list_records");
        const serializedProviderOutput = JSON.stringify(output);
        assertStringIncludes(serializedProviderOutput, "tool_result_reference");
        assertEquals(serializedProviderOutput.includes(HUGE_EMAIL_RESULT), false);
        assert(serializedProviderOutput.length < 6_000);
        return { text: "done" };
      },
    ], { only: "generate" });

    const assistant = agent({
      model: "hosted/tool-result-context-large-defaults",
      system: "Use tools.",
      skills: [],
      tools: { list_records: listRecordsTool(HUGE_EMAIL_RESULT) },
      toolResultContext: true,
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({ input: "Read the customer support thread." });

    assertEquals(response.text, "done");
    assertEquals(toolResultValue(toolResultMessage(response, "list_records")), HUGE_EMAIL_RESULT);
    assert(HUGE_EMAIL_RESULT.length > 100_000);
  });

  it("keeps small historical generate() tool results inline when the model cannot call tools", async () => {
    const result = "small historical result";
    const model = withoutToolCalling(scriptedModel([
      (options) => {
        assertEquals(firstToolOutputValue(options, "list_records"), result);
        assertEquals(toolNamesFromCall(options), []);
        return { text: "continued" };
      },
    ], { only: "generate" }));

    const assistant = agent({
      model: "hosted/tool-result-context-no-toolcall-generate-small",
      system: "Continue.",
      skills: [],
      toolResultContext: true,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({ input: historicalToolResultMessages(result) });

    assertEquals(response.text, "continued");
    assertEquals(toolResultValue(toolResultMessage(response, "list_records")), result);
  });

  it("keeps large historical generate() tool results inline when the model cannot call tools", async () => {
    const model = withoutToolCalling(scriptedModel([
      (options) => {
        const output = firstToolOutput(options, "list_records");
        const serializedOutput = JSON.stringify(output);
        assertEquals(firstToolOutputValue(options, "list_records"), HUGE_EMAIL_RESULT);
        assertEquals(serializedOutput.includes("tool_result_reference"), false);
        assertEquals(toolNamesFromCall(options), []);
        return { text: "continued" };
      },
    ], { only: "generate" }));

    const assistant = agent({
      model: "hosted/tool-result-context-no-toolcall-generate-large",
      system: "Continue.",
      skills: [],
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24 },
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({
      input: historicalToolResultMessages(HUGE_EMAIL_RESULT),
    });

    assertEquals(response.text, "continued");
    assertEquals(toolResultValue(toolResultMessage(response, "list_records")), HUGE_EMAIL_RESULT);
  });

  it("keeps small historical stream() tool results inline when the model cannot call tools", async () => {
    const result = "small historical stream result";
    const model = withoutToolCalling(scriptedModel([
      (options) => {
        assertEquals(firstToolOutputValue(options, "list_records"), result);
        assertEquals(toolNamesFromCall(options), []);
        return { text: "continued" };
      },
    ], { only: "stream" }));

    const assistant = agent({
      model: "hosted/tool-result-context-no-toolcall-stream-small",
      system: "Continue.",
      skills: [],
      toolResultContext: true,
      resolveModelTransport: () => ({ model }),
    });

    let finished: AgentResponse | undefined;
    const stream = await assistant.stream({
      messages: historicalToolResultMessages(result),
      onFinish: (response) => {
        finished = response;
      },
    });
    await stream.toDataStreamResponse().text();

    assertExists(finished);
    assertEquals(toolResultValue(toolResultMessage(finished, "list_records")), result);
  });

  it("keeps large historical stream() tool results inline when the model cannot call tools", async () => {
    const model = withoutToolCalling(scriptedModel([
      (options) => {
        const output = firstToolOutput(options, "list_records");
        const serializedOutput = JSON.stringify(output);
        assertEquals(firstToolOutputValue(options, "list_records"), HUGE_EMAIL_RESULT);
        assertEquals(serializedOutput.includes("tool_result_reference"), false);
        assertEquals(toolNamesFromCall(options), []);
        return { text: "continued" };
      },
    ], { only: "stream" }));

    const assistant = agent({
      model: "hosted/tool-result-context-no-toolcall-stream-large",
      system: "Continue.",
      skills: [],
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24 },
      resolveModelTransport: () => ({ model }),
    });

    let finished: AgentResponse | undefined;
    const stream = await assistant.stream({
      messages: historicalToolResultMessages(HUGE_EMAIL_RESULT),
      onFinish: (response) => {
        finished = response;
      },
    });
    await stream.toDataStreamResponse().text();

    assertExists(finished);
    assertEquals(toolResultValue(toolResultMessage(finished, "list_records")), HUGE_EMAIL_RESULT);
  });

  it("keeps get_tool_result visible under OpenAI's 128-tool cap after references exist", async () => {
    let ref = "";
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        const compactOutput = firstToolOutputValue(options, "list_records") as {
          ref?: string;
          type?: string;
        };
        assertEquals(compactOutput.type, "tool_result_reference");
        assertExists(compactOutput.ref);
        ref = compactOutput.ref;
        const names = toolNamesFromCall(options);
        assertEquals(names.length, 128);
        assertEquals(names.includes("get_tool_result"), true);
        assertEquals(names.includes("tool_127"), false);
        return {
          toolCalls: [{
            id: "call-read",
            name: "get_tool_result",
            input: { ref: compactOutput.ref, maxBytes: 1_000 },
          }],
        };
      },
      { text: "done" },
    ], {
      modelId: "openai/tool-result-context-cap",
      provider: "openai",
      only: "generate",
    });

    const assistant = agent({
      model: "openai/tool-result-context-cap",
      system: "Use tools.",
      skills: [],
      tools: {
        ...cappedNoopTools(128),
        list_records: listRecordsTool(HUGE_EMAIL_RESULT),
      },
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24, maxSectionBytes: 1_000 },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
    });

    const response = await assistant.generate({ input: "List records then read the result." });

    assertEquals(response.text, "done");
    assertEquals(toolResultValue(toolResultMessage(response, "get_tool_result")), {
      type: "tool_result_section",
      ref,
      toolCallId: "call-list",
      toolName: "list_records",
      totalBytes: HUGE_EMAIL_RESULT.length,
      cursor: "0",
      nextCursor: "1000",
      done: false,
      text: HUGE_EMAIL_RESULT.slice(0, 1000),
      byteLength: 1000,
    });
  });

  it("preserves default inline behavior unless toolResultContext is enabled", async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        assertEquals(firstToolOutputValue(options, "list_records"), LARGE_RESULT);
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), false);
        return { text: "done" };
      },
    ], { only: "generate" });

    const assistant = agent({
      model: "hosted/tool-result-context-default",
      system: "Use tools.",
      skills: [],
      tools: { list_records: listRecordsTool() },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
    });

    await assistant.generate({ input: "List records." });
  });

  it("compacts replayed checkpoint history without dropping signed provider metadata or raw tool history", async () => {
    const model = scriptedModel([
      (options) => {
        const output = firstToolOutput(options, "list_records");
        const serializedProviderOutput = JSON.stringify(output);
        assertStringIncludes(serializedProviderOutput, "tool_result_reference");
        assertEquals(serializedProviderOutput.includes(HUGE_EMAIL_RESULT), false);
        assert(serializedProviderOutput.length < 6_000);

        const assistantMessage = promptMessage(options, "assistant");
        assertExists(assistantMessage);
        const providerMetadata = assistantMessage.providerMetadata as {
          anthropic?: { rawAssistantMessages?: unknown };
        } | undefined;
        assertEquals(providerMetadata?.anthropic?.rawAssistantMessages, [[
          {
            type: "thinking",
            thinking: "",
            signature: CHECKPOINT_SIGNATURE,
          },
          {
            type: "tool_use",
            id: "call-list",
            name: "list_records",
            input: {},
          },
        ]]);
        return { text: "continued" };
      },
    ], {
      modelId: "anthropic/tool-result-context-replay",
      provider: "anthropic",
      only: "generate",
    });

    const assistant = agent(
      {
        id: "tool-result-context-replay",
        model: "anthropic/tool-result-context-replay",
        system: "Continue.",
        skills: false,
        tools: {},
        toolResultContext: true,
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
        __vfProviderReplayCheckpoints: [checkpointForListRecordsToolCall()],
      } as Parameters<typeof agent>[0] & RuntimeToolFilterConfig,
    );

    const response = await assistant.generate({
      input: [
        {
          id: CHECKPOINT_MESSAGE_ID,
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: "call-list",
            toolName: "list_records",
            args: {},
          }],
          timestamp: 1,
        } as Message,
        {
          id: "tool-result-message",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "call-list",
            toolName: "list_records",
            result: HUGE_EMAIL_RESULT,
          }],
          timestamp: 2,
        } as Message,
        {
          id: "continue",
          role: "user",
          parts: [{ type: "text", text: "Continue from the prior tool result." }],
          timestamp: 3,
        } as Message,
      ],
    });

    assertEquals(response.text, "continued");
    assertEquals(toolResultValue(toolResultMessage(response, "list_records")), HUGE_EMAIL_RESULT);
  });

  it("opts request-scoped replacement tools out of model-facing result compaction", async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        assertEquals(firstToolOutputValue(options, "list_records"), LARGE_RESULT);
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), false);
        return { text: "done" };
      },
    ], { only: "generate" });

    const assistant = agent({
      model: "hosted/tool-result-context-replacements",
      system: "Use tools.",
      skills: [],
      tools: {},
      toolResultContext: { maxInlineBytes: 32 },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
    });

    await assistant.generate({
      input: "List records.",
      tools: { list_records: listRecordsTool() },
    });
  });

  it("rejects before provider dispatch when a custom get_tool_result tool shadows the framework reader", async () => {
    const model = scriptedModel([
      { text: "must not dispatch" },
    ], { only: "generate" });

    const assistant = agent({
      model: "hosted/tool-result-context-shadow",
      system: "Use tools.",
      skills: [],
      tools: {
        list_records: listRecordsTool(),
        get_tool_result: customGetToolResultTool(),
      },
      toolResultContext: { maxInlineBytes: 32 },
      maxSteps: 4,
      resolveModelTransport: () => ({ model }),
    });

    const error = await assertRejects(
      () => assistant.generate({ input: "List records then read them." }),
      Error,
      "reserved for framework tool-result references",
    );
    if (!(error instanceof Error)) {
      throw new Error("expected Error rejection");
    }
    assertStringIncludes(error.message, "get_tool_result");
    assertEquals(model.callCount, 0);
  });

  it("includes a small resumed stream tool result in the next provider input", async () => {
    const smallResult = "small resumed result";
    const observedToolResults: unknown[] = [];
    const model = scriptedModel([
      (options) => {
        assertEquals(firstToolOutputValue(options, "list_records"), smallResult);
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), false);
        return { text: "continued" };
      },
    ], { only: "stream" });

    const assistant = createEphemeralAgentWithRuntimeOptions({
      id: "tool-result-context-resume-small",
      model: "hosted/tool-result-context-resume-small",
      system: "Continue after the resumed tool result.",
      skills: [],
      tools: { list_records: listRecordsTool(smallResult) },
      toolResultContext: { maxInlineBytes: 1_000, previewBytes: 24 },
      maxSteps: 2,
      resolveModelTransport: () => ({ model }),
      onToolResult: (event) => {
        if (event.toolName === "list_records") observedToolResults.push(event.result);
      },
    }, {
      resumeToolCall: {
        id: "call-list:resume-small",
        name: "list_records",
        input: {},
      },
    });

    let finished: AgentResponse | undefined;
    const stream = await assistant.stream({
      input: "continue",
      onFinish: (response) => {
        finished = response;
      },
    });
    const body = await stream.toDataStreamResponse().text();

    assertEquals(model.callCount, 1);
    assertStringIncludes(body, smallResult);
    assertEquals(observedToolResults, [smallResult]);
    assertExists(finished);
    assertEquals(toolResultValue(toolResultMessage(finished, "list_records")), smallResult);
  });

  it("references a large resumed stream tool result while preserving raw events and history", async () => {
    const observedToolResults: unknown[] = [];
    let ref = "";
    const model = scriptedModel([
      (options) => {
        const compactOutput = firstToolOutputValue(options, "list_records") as {
          type?: string;
          ref?: string;
        };
        assertEquals(compactOutput.type, "tool_result_reference");
        assertExists(compactOutput.ref);
        ref = compactOutput.ref;
        const serializedOutput = JSON.stringify(firstToolOutput(options, "list_records"));
        assertEquals(serializedOutput.includes(HUGE_EMAIL_RESULT), false);
        assert(serializedOutput.length < 6_000);
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), true);
        return {
          toolCalls: [{
            id: "call-read-resumed",
            name: "get_tool_result",
            input: { ref: compactOutput.ref, maxBytes: 1_000 },
          }],
        };
      },
      { text: "continued" },
    ], { only: "stream" });

    const assistant = createEphemeralAgentWithRuntimeOptions({
      id: "tool-result-context-resume-large",
      model: "hosted/tool-result-context-resume-large",
      system: "Continue after the resumed tool result.",
      skills: [],
      tools: { list_records: listRecordsTool(HUGE_EMAIL_RESULT) },
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24, maxSectionBytes: 1_000 },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
      onToolResult: (event) => {
        if (event.toolName === "list_records") observedToolResults.push(event.result);
      },
    }, {
      resumeToolCall: {
        id: "call-list:resume-large",
        name: "list_records",
        input: {},
      },
    });

    let finished: AgentResponse | undefined;
    const stream = await assistant.stream({
      input: "continue",
      onFinish: (response) => {
        finished = response;
      },
    });
    const body = await stream.toDataStreamResponse().text();

    assertEquals(model.callCount, 2);
    assertStringIncludes(body, "tool-output-available");
    assertStringIncludes(body, "Long customer support thread");
    assertEquals(observedToolResults, [HUGE_EMAIL_RESULT]);
    assertExists(finished);
    assertEquals(toolResultValue(toolResultMessage(finished, "list_records")), HUGE_EMAIL_RESULT);
    assertEquals(toolResultValue(toolResultMessage(finished, "get_tool_result")), {
      type: "tool_result_section",
      ref,
      toolCallId: "call-list:resume-large",
      toolName: "list_records",
      totalBytes: HUGE_EMAIL_RESULT.length,
      cursor: "0",
      nextCursor: "1000",
      done: false,
      text: HUGE_EMAIL_RESULT.slice(0, 1000),
      byteLength: 1000,
    });
  });

  it("compacts stream() provider input while keeping onToolResult and final history raw", async () => {
    const observedToolResults: unknown[] = [];
    const model = scriptedModel([
      { toolCalls: [{ id: "call-list", name: "list_records", input: {} }] },
      (options) => {
        const compactOutput = firstToolOutputValue(options, "list_records") as { type?: string };
        assertEquals(compactOutput.type, "tool_result_reference");
        assertEquals(toolNamesFromCall(options).includes("get_tool_result"), true);
        return { text: "done" };
      },
    ], { only: "stream" });

    const assistant = agent({
      model: "hosted/tool-result-context-stream",
      system: "Use tools.",
      skills: [],
      tools: { list_records: listRecordsTool() },
      toolResultContext: { maxInlineBytes: 32, previewBytes: 24 },
      maxSteps: 3,
      resolveModelTransport: () => ({ model }),
      onToolResult: (event) => {
        if (event.toolName === "list_records") observedToolResults.push(event.result);
      },
    });

    let finished: AgentResponse | undefined;
    const stream = await assistant.stream({
      input: "List records.",
      onFinish: (response) => {
        finished = response;
      },
    });
    await stream.toDataStreamResponse().text();

    assertEquals(observedToolResults, [LARGE_RESULT]);
    assertExists(finished);
    assertEquals(toolResultValue(toolResultMessage(finished, "list_records")), LARGE_RESULT);
  });
});
