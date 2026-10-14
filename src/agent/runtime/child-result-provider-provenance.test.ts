import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { AgentRuntime } from "./index.ts";
import { createToolResultContext } from "./tool-result-context.ts";
import { createModelToolResultContextMessages } from "./tool-result-context-messages.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import type { Message, ToolResultPart } from "../types.ts";
import {
  buildChildRunExecutionSnapshot,
  buildChildRunSuccessResult,
  type ChildRunExecutionUsage,
  type ChildRunToolCallSnapshot,
  type ChildRunToolResultSnapshot,
} from "../child-run/execution-snapshot.ts";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
import { withRootOwnedChildResultHint } from "../conversation/delegation-policy.ts";
import {
  finalizeHostedChildForkCompletion,
  handleHostedChildForkStreamPart,
} from "../hosted/child-fork-stream-execution.ts";
import { summarizeChildRunResultValue } from "../child-run/result-summary.ts";
import { buildHostedDurableChildInvokeSuccessResult } from "../hosted/durable-child-fork-execution.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "./message-adapter.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";
import type { TextGenerationRuntimeToolMessage } from "./text-generation-runtime-message-types.ts";
import {
  hasTrustedPlatformPolicyToolResultPart,
  markTrustedPlatformPolicyToolResultPart,
  prepareTrustedPlatformPolicyMessageForPersistence,
  restoreTrustedPlatformPolicyResultsFromPersistedHistory,
  stripTrustedPlatformPolicyMessageMetadata,
} from "./skill-policy-enforcement.ts";

function childResult() {
  return {
    ok: true,
    status: "completed",
    childRunId: "child",
    text: "trace prose",
    summary: { text: "trace prose" },
    output: { directory: "accepted" },
    rootResponseHint: { instruction: "guidance", suggestedText: "trace prose" },
  };
}

function resultMessage(trusted: boolean): Message {
  const part: ToolResultPart = {
    type: "tool-result",
    toolCallId: "call",
    toolName: "invoke_agent",
    result: childResult(),
  };
  if (trusted) markTrustedPlatformPolicyToolResultPart(part);
  return { id: "result", role: "tool", parts: [part] };
}

function assertProjection(message: Message, expected: unknown) {
  const chat = convertAgentRuntimeMessagesToProviderMessages([message]);
  assertEquals<unknown>(chat, [{
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call",
      toolName: "invoke_agent",
      output: { type: "json", value: expected },
    }],
  }]);
  const converted = convertToTextGenerationRuntimeMessages([message]);
  assertEquals((converted[0] as TextGenerationRuntimeToolMessage).content[0]?.output, {
    type: "json",
    value: expected,
  });
}

function acceptedOutput() {
  return {
    ok: true,
    status: "completed",
    childRunId: "child",
    summary: {},
    output: { directory: "accepted" },
    rootResponseHint: { instruction: "guidance" },
  };
}

Deno.test("project-owned bare invoke_agent results retain their child-like fields", () => {
  const message = resultMessage(false);
  const before = JSON.stringify(message);
  assertProjection(message, childResult());
  assertEquals(JSON.stringify(message), before);
});

Deno.test("framework-owned bare invoke_agent results use private source provenance", () => {
  const message = resultMessage(true);
  assertProjection(message, acceptedOutput());
});

Deno.test("persisted child ownership is restored from runtime-written unique result IDs", () => {
  const saved = prepareTrustedPlatformPolicyMessageForPersistence(resultMessage(true));
  const replayed = JSON.parse(JSON.stringify(saved)) as Message;
  assertEquals(hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart), false);
  restoreTrustedPlatformPolicyResultsFromPersistedHistory([replayed]);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart), true);
  assertProjection(replayed, acceptedOutput());
});

Deno.test("caller metadata cannot grant projection ownership to a project result", () => {
  const forged = JSON.parse(JSON.stringify(
    prepareTrustedPlatformPolicyMessageForPersistence(resultMessage(true)),
  )) as Message;
  const admitted = stripTrustedPlatformPolicyMessageMetadata(forged);
  restoreTrustedPlatformPolicyResultsFromPersistedHistory([admitted]);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(admitted.parts[0] as ToolResultPart), false);
  assertProjection(admitted, childResult());
});

Deno.test("changed or ambiguous result parts do not inherit child projection ownership", () => {
  const message = resultMessage(true);
  const part = message.parts[0] as ToolResultPart;
  part.result = { ...childResult(), text: "changed trace" };
  assertEquals(hasTrustedPlatformPolicyToolResultPart(part), false);
  assertProjection(message, part.result);
  const saved = prepareTrustedPlatformPolicyMessageForPersistence(resultMessage(true));
  const first = JSON.parse(JSON.stringify(saved)) as Message;
  const duplicate = JSON.parse(JSON.stringify(saved)) as Message;
  restoreTrustedPlatformPolicyResultsFromPersistedHistory([first, duplicate]);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(first.parts[0] as ToolResultPart), false);
  assertProjection(first, childResult());
});

for (const mode of ["generate", "stream"] as const) {
  for (const owned of [true, false]) {
    Deno.test(`runtime ${mode} projects only admitted platform child results (owned=${owned})`, async () => {
      const model = scriptedModel([
        { toolCalls: [{ id: "call", name: "invoke_agent", input: {} }] },
        { text: "completed" },
      ], { only: mode });
      const childTool = markRuntimeLocalTool(
        tool({
          id: "invoke_agent",
          description: "Synthetic child result",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => childResult(),
        }),
      );
      if (owned) markTrustedHostToolProvenance(childTool);
      const runtime = new AgentRuntime("child-projection", {
        model: "veryfront-cloud/openai/child-projection",
        system: "Process the synthetic result.",
        security: false,
        skills: false,
        maxSteps: 2,
        tools: { invoke_agent: childTool },
      }, { resolveModelRuntime: () => model });
      const input: Message[] = [{
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "Process the synthetic result" }],
      }];
      if (mode === "generate") await runtime.generate(input);
      else await new Response(await runtime.stream(input)).text();
      assertEquals(model.callCount, 2);
      const prompt = JSON.stringify(model.calls[1]?.prompt);
      assertStringIncludes(prompt, "accepted");
      assertEquals(prompt.includes("trace prose"), !owned);
    });
  }
}

Deno.test("accepted scalar child outputs replace conflicting prose on both provider seams", () => {
  for (const output of ["trace prose", 42, true, null]) {
    const original = { ...childResult(), output };
    for (
      const recorded of [original, { type: "json", value: original }, JSON.stringify(original)]
    ) {
      const message = resultMessage(false);
      const part = message.parts[0] as ToolResultPart;
      part.result = recorded;
      markTrustedPlatformPolicyToolResultPart(part);
      const before = JSON.stringify(message);
      assertProjection(message, { ...acceptedOutput(), output });
      assertEquals(JSON.stringify(message), before);
    }
  }
});

function durableChildResult(usage?: ChildRunExecutionUsage, telemetry?: {
  toolCalls: ChildRunToolCallSnapshot[];
  toolResults: ChildRunToolResultSnapshot[];
}) {
  const result = buildChildRunSuccessResult({
    description: "Synthetic durable child",
    steps: 1,
    toolCalls: telemetry?.toolCalls ?? [],
    toolResults: telemetry?.toolResults ?? [],
    durationMs: 1,
    ...(usage === undefined ? {} : { usage }),
  }, buildChildRunResultSummary("durable child response"));
  return withRootOwnedChildResultHint(buildHostedDurableChildInvokeSuccessResult({
    result,
    snapshot: buildChildRunExecutionSnapshot(result),
    identifiers: {
      childConversationId: "conversation",
      childRunId: "child",
      childMessageId: "message",
      latestEventId: 1,
      latestExternalEventSequence: 1,
    },
    targets: {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetBranchId: "branch",
    },
  }));
}

Deno.test("actual durable success producer preserves optional usage and admitted projection", () => {
  for (const usage of [undefined, { inputTokens: 3, outputTokens: 4, totalTokens: 7 }]) {
    const result = durableChildResult(usage);
    assertEquals(Object.hasOwn(result, "usage"), usage !== undefined);
    if (usage !== undefined) assertEquals(result.usage, usage);
    const message = resultMessage(false);
    const part = message.parts[0] as ToolResultPart;
    part.result = result;
    markTrustedPlatformPolicyToolResultPart(part);
    assertEquals(hasTrustedPlatformPolicyToolResultPart(part), true);
    const before = JSON.stringify(message);
    const replayed = JSON.parse(JSON.stringify(
      prepareTrustedPlatformPolicyMessageForPersistence(message),
    )) as Message;
    restoreTrustedPlatformPolicyResultsFromPersistedHistory([replayed]);
    assertEquals(hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart), true);
    for (const admitted of [message, replayed]) {
      const chat = convertAgentRuntimeMessagesToProviderMessages([admitted]);
      const active = convertToTextGenerationRuntimeMessages([admitted]);
      for (const converted of [chat, active]) {
        const encoded = JSON.stringify(converted);
        assertEquals(encoded.split("durable child response").length - 1, 1);
        assertEquals(encoded.includes("suggestedText"), false);
      }
    }
    assertEquals(JSON.stringify(message), before);
  }
});

for (const mode of ["generate", "stream"] as const) {
  Deno.test(`actual durable success without usage projects after runtime ${mode} dispatch`, async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "call", name: "invoke_agent", input: {} }] },
      { text: "completed" },
    ], { only: mode });
    const childTool = markTrustedHostToolProvenance(markRuntimeLocalTool(tool({
      id: "invoke_agent",
      description: "Synthetic durable producer",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => durableChildResult(),
    })));
    const runtime = new AgentRuntime("durable-projection", {
      model: "veryfront-cloud/openai/durable-projection",
      system: "Process the synthetic result.",
      security: false,
      skills: false,
      maxSteps: 2,
      tools: { invoke_agent: childTool },
    }, { resolveModelRuntime: () => model });
    const input: Message[] = [{
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "Process the synthetic result" }],
    }];
    if (mode === "generate") await runtime.generate(input);
    else await new Response(await runtime.stream(input)).text();
    assertEquals(model.callCount, 2);
    const prompt = JSON.stringify(model.calls[1]?.prompt);
    assertEquals(prompt.split("durable child response").length - 1, 1);
    assertEquals(prompt.includes("suggestedText"), false);
  });
}

Deno.test("admitted child output is preserved beyond chat default normalization limits", () => {
  let deep: unknown = "accepted";
  for (let index = 0; index < 96; index++) deep = { child: deep };
  const outputs = [
    Array.from({ length: 10_001 }, (_, index) => index),
    Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`key-${index}`, index])),
    Array.from({ length: 500 }, () => Array.from({ length: 140 }, (_, index) => index)),
    deep,
  ];
  for (const output of outputs) {
    const message = resultMessage(false);
    const part = message.parts[0] as ToolResultPart;
    part.result = { ...childResult(), output };
    markTrustedPlatformPolicyToolResultPart(part);
    assertEquals(hasTrustedPlatformPolicyToolResultPart(part), true);
    const before = JSON.stringify(message);
    assertProjection(message, { ...acceptedOutput(), output });
    assertEquals(JSON.stringify(message), before);
  }
});

Deno.test("child result disclosure projects before wrapping and preserves raw identity", () => {
  for (const toolName of ["invoke_agent", "veryfront__invoke_agent"]) {
    for (const owned of [true, false]) {
      const message = resultMessage(false);
      const part = message.parts[0] as ToolResultPart;
      part.toolName = toolName;
      const original = {
        ...childResult(),
        output: { marker: "accepted", padding: "x".repeat(8_000) },
      };
      part.result = original;
      if (owned) markTrustedPlatformPolicyToolResultPart(part);
      const before = JSON.stringify(message);
      const context = createToolResultContext({
        limits: {
          maxInlineBytes: 256,
          previewBytes: 512,
          maxSectionBytes: 16_000,
          maxStoredResults: 1,
        },
      });
      const first = createModelToolResultContextMessages([message], context);
      const second = createModelToolResultContextMessages([message], context);
      const reference = (first[0]?.parts[0] as ToolResultPart).result as {
        type: string;
        ref: string;
      };
      assertEquals(reference.type, "tool_result_reference");
      assertEquals((second[0]?.parts[0] as ToolResultPart).result, reference);
      assertEquals(context.size, 1);
      assertStrictEquals(context.getOriginalResult(reference.ref), original);
      const section = context.read({ ref: reference.ref, maxBytes: 16_000 });
      assertEquals(section.done, true);
      assertEquals(section.text.includes("trace prose"), !owned);
      assertEquals(section.text.includes("suggestedText"), !owned);
      assertStringIncludes(section.text, "accepted");
      for (
        const converted of [
          convertAgentRuntimeMessagesToProviderMessages(first),
          convertToTextGenerationRuntimeMessages(first),
        ]
      ) {
        assertEquals(JSON.stringify(converted).includes("trace prose"), !owned);
      }
      const spillPart: ToolResultPart = { ...part, toolCallId: "spill" };
      if (owned) markTrustedPlatformPolicyToolResultPart(spillPart);
      const spill = createModelToolResultContextMessages([{
        ...message,
        id: "spill",
        parts: [spillPart],
      }], context);
      const preview = (spill[0]?.parts[0] as ToolResultPart).result as {
        type: string;
        complete: boolean;
      };
      assertEquals(preview.type, "tool_result_preview");
      assertEquals(preview.complete, false);
      assertEquals(JSON.stringify(spill).includes("trace prose"), !owned);
      assertEquals(context.size, 1);
      assertEquals(JSON.stringify(message), before);
    }
  }
});

for (const mode of ["generate", "stream"] as const) {
  Deno.test(`runtime ${mode} applies child projection before result-context wrapping`, async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: "call", name: "invoke_agent", input: {} }] },
      { text: "completed" },
    ], { only: mode });
    const childTool = markTrustedHostToolProvenance(markRuntimeLocalTool(tool({
      id: "invoke_agent",
      description: "Synthetic child disclosure",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({
        ...childResult(),
        output: { marker: "accepted", padding: "x".repeat(8_000) },
      }),
    })));
    const runtime = new AgentRuntime("context-projection", {
      model: "veryfront-cloud/openai/context-projection",
      system: "Process the synthetic result.",
      security: false,
      skills: false,
      maxSteps: 2,
      toolResultContext: { maxInlineBytes: 256, previewBytes: 512, maxSectionBytes: 16_000 },
      tools: { invoke_agent: childTool },
    }, { resolveModelRuntime: () => model });
    const input: Message[] = [{
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "Process" }],
    }];
    if (mode === "generate") await runtime.generate(input);
    else await new Response(await runtime.stream(input)).text();
    assertEquals(model.callCount, 2);
    const prompt = JSON.stringify(model.calls[1]?.prompt);
    assertStringIncludes(prompt, "tool_result_reference");
    assertStringIncludes(prompt, "accepted");
    assertEquals(prompt.includes("trace prose"), false);
  });
}

Deno.test("actual child telemetry capture admits undefined values without changing raw events", async () => {
  const large = Array.from({ length: 10_001 }, (_, index) => index);
  const cases = [
    { output: undefined, expected: null },
    {
      output: { nested: { value: undefined }, values: [undefined, 42] },
      expected: { nested: { value: null }, values: [null, 42] },
    },
    {
      output: { optional: undefined, payload: large },
      expected: { optional: null, payload: large },
    },
  ];
  for (const { output, expected } of cases) {
    const toolCalls: ChildRunToolCallSnapshot[] = [];
    const toolResults: ChildRunToolResultSnapshot[] = [];
    const chunks: unknown[] = [];
    const input = { optional: undefined, valid: large };
    const hooks = {
      description: "Synthetic telemetry",
      durableMessageId: null,
      durableReasoningMessageId: null,
      durableMirrorState: { reasoningStarted: false, textStarted: false },
      appendDurableMirrorChunk: (chunk: unknown) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      closeDurableMirrorReasoning: () => Promise.resolve(),
      closeDurableMirrorText: () => Promise.resolve(),
      pendingToolLifecycle: {
        emitToolInputStartIfNeeded: () => undefined,
        upsertPendingToolCall: () => undefined,
        deletePendingToolCall: () => undefined,
        closePendingToolCalls: () => undefined,
      },
      toolCalls,
      toolResults,
      state: { activeToolCallId: null, finalText: "", shouldSeparateNextTextBlock: false },
    };
    const state = await handleHostedChildForkStreamPart({
      ...hooks,
      part: { type: "tool-call", toolName: "example", toolCallId: "telemetry", input },
    });
    await handleHostedChildForkStreamPart({
      ...hooks,
      state,
      part: { type: "tool-result", toolName: "example", toolCallId: "telemetry", input, output },
    });
    assertEquals(
      (chunks.at(-1) as { output: unknown }).output,
      summarizeChildRunResultValue(output),
    );
    const message = resultMessage(false);
    const part = message.parts[0] as ToolResultPart;
    part.result = durableChildResult(undefined, { toolCalls, toolResults });
    markTrustedPlatformPolicyToolResultPart(part);
    assertEquals(hasTrustedPlatformPolicyToolResultPart(part), true);
    assertEquals(toolCalls[0]?.input, { optional: null, valid: large });
    assertEquals(toolResults[0]?.input, { optional: null, valid: large });
    assertEquals(toolResults[0]?.output, expected);

    const replayed = JSON.parse(
      JSON.stringify(prepareTrustedPlatformPolicyMessageForPersistence(message)),
    ) as Message;
    restoreTrustedPlatformPolicyResultsFromPersistedHistory([replayed]);
    assertEquals(hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart), true);
    for (const admitted of [message, replayed]) {
      for (
        const converted of [
          convertAgentRuntimeMessagesToProviderMessages([admitted]),
          convertToTextGenerationRuntimeMessages([admitted]),
        ]
      ) {
        const serialized = JSON.stringify(converted);
        assertEquals(serialized.split("durable child response").length - 1, 1);
        assertEquals(serialized.includes("suggestedText"), false);
        assertEquals(serialized.includes("[Truncated]"), false);
      }
    }
  }
});

Deno.test("final-step child telemetry admits undefined output when the stream omitted tool parts", async () => {
  const input = { optional: undefined };
  const local = await finalizeHostedChildForkCompletion({
    streamResult: {
      fullStream: (async function* () {})(),
      steps: Promise.resolve([{
        text: "durable child response",
        finishReason: "stop",
        messages: [],
        toolCalls: [{ toolName: "example", toolCallId: "fallback", input }],
        toolResults: [{ toolName: "example", toolCallId: "fallback", input, output: undefined }],
      }]),
      totalUsage: Promise.resolve(undefined),
    },
    finalText: "durable child response",
    description: "Synthetic fallback",
    kind: "invoke_agent",
    maxSteps: 2,
    toolCalls: [],
    toolResults: [],
    startTime: Date.now(),
    durableMessageId: null,
    durableMirrorHasEmittedProgress: true,
    appendDurableMirrorChunk: () => Promise.resolve(),
    finalizationTimeoutMs: 100,
  });
  assertEquals(local.success, true);
  const message = resultMessage(false);
  const part = message.parts[0] as ToolResultPart;
  part.result = durableChildResult(undefined, local);
  markTrustedPlatformPolicyToolResultPart(part);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(part), true);
  assertEquals(local.toolCalls[0]?.input, { optional: null });
  assertEquals(local.toolResults[0]?.input, { optional: null });
  assertEquals(local.toolResults[0]?.output, null);
  const replayed = JSON.parse(
    JSON.stringify(prepareTrustedPlatformPolicyMessageForPersistence(message)),
  ) as Message;
  restoreTrustedPlatformPolicyResultsFromPersistedHistory([replayed]);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart), true);
  for (const admitted of [message, replayed]) {
    for (
      const converted of [
        convertAgentRuntimeMessagesToProviderMessages([admitted]),
        convertToTextGenerationRuntimeMessages([admitted]),
      ]
    ) {
      assertEquals(JSON.stringify(converted).split("durable child response").length - 1, 1);
    }
  }
});

Deno.test("complete child handoffs bound multibyte telemetry before provenance admission", () => {
  const output = Array.from({ length: 3000 }, () => "界".repeat(500));
  const telemetryCases = [{
    toolCalls: [{ toolName: "example", toolCallId: "budget", input: output }],
    toolResults: [{ toolName: "example", toolCallId: "budget", input: output, output }],
  }, {
    toolCalls: Array.from({ length: 35_000 }, (_, index) => ({
      toolName: "example",
      toolCallId: String(index),
      input: index,
    })),
    toolResults: [],
  }];
  for (const telemetry of telemetryCases) {
    const raw = JSON.stringify(telemetry);
    const local = buildChildRunSuccessResult({
      description: "Synthetic budget",
      steps: 1,
      durationMs: 1,
      ...telemetry,
    }, buildChildRunResultSummary("durable child response"));
    for (const result of [local, durableChildResult(undefined, telemetry)]) {
      const message = resultMessage(false);
      const part = message.parts[0] as ToolResultPart;
      part.result = result;
      markTrustedPlatformPolicyToolResultPart(part);
      assertEquals(hasTrustedPlatformPolicyToolResultPart(part), true);
      const replayed = JSON.parse(JSON.stringify(
        prepareTrustedPlatformPolicyMessageForPersistence(message),
      )) as Message;
      restoreTrustedPlatformPolicyResultsFromPersistedHistory([replayed]);
      assertEquals(
        hasTrustedPlatformPolicyToolResultPart(replayed.parts[0] as ToolResultPart),
        true,
      );
      for (const admitted of [message, replayed]) {
        for (
          const converted of [
            convertAgentRuntimeMessagesToProviderMessages([admitted]),
            convertToTextGenerationRuntimeMessages([admitted]),
          ]
        ) {
          assertEquals(JSON.stringify(converted).split("durable child response").length - 1, 1);
        }
      }
    }
    assertEquals(JSON.stringify(telemetry), raw);
  }
});
