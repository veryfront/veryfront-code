import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { AgentRuntime } from "./index.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import type { Message, ToolResultPart } from "../types.ts";
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
