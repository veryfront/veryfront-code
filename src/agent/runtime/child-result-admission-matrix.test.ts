import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import {
  JSON_VALUE_MAX_NODES,
  JSON_VALUE_MAX_STRING_BYTES,
  snapshotBoundedParsedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import { PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES } from "../platform-tool-result-limits.ts";
import { boundChildResultTelemetry } from "../child-run/result-telemetry.ts";
import { buildChildRunExecutionSnapshot } from "../child-run/execution-snapshot.ts";
import { buildHostedDurableChildInvokeSuccessResult } from "../hosted/durable-child-fork-execution.ts";
import { finalizeHostedChildForkCompletion } from "../hosted/child-fork-stream-execution.ts";
import { withRootOwnedChildResultHint } from "../conversation/delegation-policy.ts";
import type { Message, ToolResultPart } from "../types.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "./message-adapter.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";
import {
  hasTrustedPlatformPolicyToolResultPart,
  markTrustedPlatformPolicyToolResultPart,
  prepareTrustedPlatformPolicyMessageForPersistence,
  restoreTrustedPlatformPolicyResultsFromPersistedHistory,
} from "./skill-policy-enforcement.ts";

function messageFor(result: unknown): Message {
  return {
    id: "matrix-message",
    role: "tool",
    parts: [{ type: "tool-result", toolCallId: "matrix-call", toolName: "invoke_agent", result }],
  } as Message;
}
function admitted(result: unknown): boolean {
  const part = messageFor(result).parts[0] as ToolResultPart;
  markTrustedPlatformPolicyToolResultPart(part);
  return hasTrustedPlatformPolicyToolResultPart(part);
}
function utf8String(bytes: number): string {
  return "界".repeat(Math.floor(bytes / 3)) + "x".repeat(bytes % 3);
}
function sourceBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
function nodes(value: unknown): number {
  return 1 +
    (value !== null && typeof value === "object"
      ? Object.values(value).reduce<number>((total, item) => total + nodes(item), 0)
      : 0);
}
async function capture(input: unknown) {
  return await finalizeHostedChildForkCompletion({
    streamResult: {
      fullStream: (async function* () {})(),
      steps: Promise.resolve([{
        text: "obsolete-child-prose",
        finishReason: "stop",
        messages: [],
        toolCalls: [{ toolName: "example", toolCallId: "trace", input }],
        toolResults: [],
      }]),
      totalUsage: Promise.resolve(undefined),
    },
    finalText: "obsolete-child-prose",
    description: "Admission matrix",
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
}
function durable(local: Awaited<ReturnType<typeof capture>>) {
  return buildHostedDurableChildInvokeSuccessResult({
    result: local,
    snapshot: buildChildRunExecutionSnapshot(local),
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
  });
}
function replayAndConvert(result: unknown, eligible: boolean, retainProse = false) {
  const before = JSON.stringify(result);
  const source = (typeof result === "string" ? JSON.parse(result) : result) as Record<
    string,
    unknown
  >;
  const message = messageFor(result);
  const part = message.parts[0] as ToolResultPart;
  markTrustedPlatformPolicyToolResultPart(part);
  const owns = hasTrustedPlatformPolicyToolResultPart(part);
  const saved = JSON.parse(JSON.stringify(
    prepareTrustedPlatformPolicyMessageForPersistence(message),
  )) as Message;
  restoreTrustedPlatformPolicyResultsFromPersistedHistory([saved]);
  assertEquals(hasTrustedPlatformPolicyToolResultPart(saved.parts[0] as ToolResultPart), owns);
  for (const history of [message, saved]) {
    for (
      const converted of [
        convertAgentRuntimeMessagesToProviderMessages([history]),
        convertToTextGenerationRuntimeMessages([history]),
      ]
    ) {
      if (retainProse) {
        assertEquals(owns, true);
        assertEquals(JSON.stringify(converted).split("obsolete-child-prose").length - 1, 1);
      } else {
        assertEquals(JSON.stringify(converted).includes("obsolete-child-prose"), !eligible);
        if (eligible && Object.hasOwn(source, "output")) {
          const value = (converted[0] as {
            content: Array<{
              output: { value: Record<string, unknown> };
            }>;
          }).content[0]?.output.value;
          assertEquals(value?.output, source.output);
        }
      }
    }
  }
  assertEquals(JSON.stringify(result), before);
}
function structured<T>(base: ReturnType<typeof durable>, output: T) {
  // Recorded canonical output is admitted separately from copied execution telemetry.
  return {
    ...withRootOwnedChildResultHint(base),
    toolCalls: base.toolCalls ?? [],
    toolResults: base.toolResults ?? [],
    output,
  };
}
function byteEnvelope(base: ReturnType<typeof durable>, target: number) {
  const output = {
    a: "x".repeat(JSON_VALUE_MAX_STRING_BYTES),
    b: "x".repeat(JSON_VALUE_MAX_STRING_BYTES),
    c: "x".repeat(JSON_VALUE_MAX_STRING_BYTES),
    d: "x".repeat(JSON_VALUE_MAX_STRING_BYTES),
    padding: "",
  };
  const result = structured(base, output);
  output.padding = "x".repeat(target - sourceBytes(result));
  assertEquals(sourceBytes(result), target);
  return result;
}

describe("child admission differential boundary matrix", () => {
  for (const delta of [-1, 0, 1]) {
    for (const multibyte of [false, true]) {
      it(`capture and handoffs retain eligible ${multibyte ? "multibyte" : "ASCII"} string ${delta}`, async () => {
        const bytes = JSON_VALUE_MAX_STRING_BYTES + delta;
        const input = multibyte ? utf8String(bytes) : "x".repeat(bytes);
        const untouched = {
          success: true,
          description: "Admission matrix",
          summary: { text: "obsolete-child-prose" },
          steps: 1,
          durationMs: 1,
          toolCalls: [{ toolName: "example", toolCallId: "trace", input }],
          toolResults: [],
        };
        const wasEligible = admitted(untouched);
        const local = await capture(input);
        if (wasEligible) assertEquals(local.toolCalls[0]?.input, input);
        for (const envelope of [local, durable(local)]) {
          const hinted = withRootOwnedChildResultHint(envelope);
          assertEquals(admitted(hinted), true);
          for (const shape of [hinted, JSON.stringify(hinted)]) {
            replayAndConvert(shape, true, true);
          }
        }
      });
    }
    it(`direct and encoded accepted string byte boundary ${delta}`, async () => {
      const base = durable(await capture(null));
      for (
        const output of [
          "x".repeat(JSON_VALUE_MAX_STRING_BYTES + delta),
          utf8String(JSON_VALUE_MAX_STRING_BYTES + delta),
        ]
      ) {
        const raw = structured(base, output);
        for (const result of [raw, JSON.stringify(raw)]) {
          const eligible = admitted(result) && (typeof result !== "string" ||
            snapshotBoundedParsedJsonValue(raw, PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES).success);
          replayAndConvert(result, eligible);
        }
      }
    });
    it(`complete byte envelope direct/encoded ${delta}`, async () => {
      const raw = byteEnvelope(
        durable(await capture(null)),
        PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES + delta,
      );
      for (const shape of [raw, JSON.stringify(raw)]) replayAndConvert(shape, admitted(shape));
    });
    it(`actual node capture and staged handoff boundary ${delta}`, async () => {
      const baseline = await capture([]);
      const count = JSON_VALUE_MAX_NODES + delta - nodes(baseline) - 4;
      const input = Array.from({ length: count }, () => 0);
      const local = await capture(input);
      const stages = [
        local,
        durable(local),
        withRootOwnedChildResultHint(local),
        withRootOwnedChildResultHint(durable(local)),
      ];
      for (const stage of stages) {
        assertEquals(admitted(stage), true);
        const raw = { ...stage, toolCalls: [{ toolName: "example", toolCallId: "trace", input }] };
        if (admitted(raw)) assertEquals(stage.toolCalls?.[0]?.input, input);
        for (const shape of [stage, JSON.stringify(stage)]) replayAndConvert(shape, true, true);
      }
      assertEquals(input.length, count);
    });
    it(`single-string encoded source byte ceiling ${delta}`, async () => {
      for (const multibyte of [false, true]) {
        const raw = structured(durable(await capture(null)), "");
        const target = PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES + delta;
        const bytes = target - sourceBytes(raw);
        raw.output = multibyte ? utf8String(bytes) : "x".repeat(bytes);
        assertEquals(sourceBytes(raw), target);
        for (const shape of [raw, JSON.stringify(raw)]) {
          const eligible = admitted(shape) && (typeof shape !== "string" ||
            snapshotBoundedParsedJsonValue(raw, PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES).success);
          replayAndConvert(shape, eligible);
        }
      }
    });
    it(`direct and encoded structural node boundary ${delta}`, async () => {
      const raw = structured(durable(await capture(null)), [] as number[]);
      // Provenance's identity record adds four nodes around the direct result.
      const count = JSON_VALUE_MAX_NODES + delta - nodes(raw) - 4;
      raw.output = Array.from({ length: count }, () => 0);
      for (const shape of [raw, JSON.stringify(raw)]) {
        const eligible = admitted(shape) && (typeof shape !== "string" ||
          snapshotBoundedParsedJsonValue(raw, PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES).success);
        replayAndConvert(shape, eligible);
      }
      // Parsed encoded JSON has its own released structural ceiling.
      raw.output.push(0, 0, 0, 0);
      const encoded = JSON.stringify(raw);
      replayAndConvert(
        encoded,
        admitted(encoded) &&
          snapshotBoundedParsedJsonValue(raw, PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES).success,
      );
    });
    it(`omission metadata at remaining byte allowance ${delta}`, async () => {
      const raw = byteEnvelope(
        { ...durable(await capture(null)), toolCalls: [], toolResults: [] },
        PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES + delta,
      );
      const baseEligible = admitted(raw);
      raw.toolCalls = [{ toolName: "example", toolCallId: "trace", input: "x".repeat(1000) }];
      const bounded = boundChildResultTelemetry(raw);
      assertStrictEquals(bounded.output, raw.output);
      if (baseEligible) {
        const { rootResponseHint: _hint, ...beforeHint } = raw;
        const hinted = withRootOwnedChildResultHint(boundChildResultTelemetry(beforeHint));
        assertEquals(admitted(hinted), true);
        assertStrictEquals(hinted.output, raw.output);
        assertEquals(admitted(bounded), true);
        for (const shape of [bounded, JSON.stringify(bounded)]) replayAndConvert(shape, true);
      } else assertEquals(admitted(bounded), false);
    });
  }
});
