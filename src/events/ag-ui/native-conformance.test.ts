import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agUiPositiveFixtures } from "./fixtures.mjs";
import {
  acceptAgUiEvent,
  AG_UI_EVENT_TYPES,
  type AgUiEvent,
  type AgUiEventOf,
  type AgUiExpandedEventCommand,
  type AgUiNativeProfileContext,
  type AgUiNormalizationCommand,
  type AgUiNormalizationState,
  type AgUiProducerOccurrence,
  parseAgUiEvent,
  parseNativeProfileRecord,
  projectNativeProfileEvent,
} from "./index.ts";

const SOURCE = "https://example.test/ag-ui/conformance";

type AgUiNativeProfileEventCommand = Extract<
  AgUiNormalizationCommand,
  { readonly kind: "canonical-native-event" }
>;

function occurrenceFor(index: number, type: string): AgUiProducerOccurrence & {
  readonly time: string;
} {
  return {
    source: SOURCE,
    id: `fixture-${index}-${type.toLowerCase().replaceAll("_", "-")}`,
    time: "2026-10-06T12:00:00.000Z",
  };
}

function nativeMessageId(agUiMessageId: string): string {
  return `native-message:${agUiMessageId}`;
}

function nativeContentId(kind: "text" | "reasoning", agUiMessageId: string): string {
  return `native-content:${kind}:${agUiMessageId}`;
}

function nativeToolCallId(agUiToolCallId: string): string {
  return `native-tool:${agUiToolCallId}`;
}

function nativeToolName(agUiToolCallId: string, agUiToolCallName?: string): string {
  return `native-tool-name:${agUiToolCallName ?? agUiToolCallId}`;
}

function nativeStepId(agUiStepName: string): string {
  return `native-step:${agUiStepName}`;
}

function runContext(
  event: AgUiEventOf<"RUN_STARTED" | "RUN_FINISHED" | "RUN_ERROR">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  const runId = event.type === "RUN_ERROR" ? "run-error-fixture" : event.runId;
  const threadId = event.type === "RUN_ERROR" ? "thread-error-fixture" : event.threadId;
  return {
    family: "run",
    run: {
      occurrence,
      runid: `native-run:${runId}`,
      agui: { threadId, runId },
      runkind: "agent",
      conversationid: "conversation-fixture",
    },
  };
}

function textContext(
  event: AgUiEventOf<"TEXT_MESSAGE_START" | "TEXT_MESSAGE_CONTENT" | "TEXT_MESSAGE_END">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "content",
    content: {
      family: "text",
      occurrence,
      message: {
        nativeMessageId: nativeMessageId(event.messageId),
        nativeContentId: nativeContentId("text", event.messageId),
        agUiMessageId: event.messageId,
      },
    },
  };
}

function reasoningMessageContext(
  event:
    | AgUiEventOf<"REASONING_MESSAGE_START">
    | AgUiEventOf<"REASONING_MESSAGE_CONTENT">
    | AgUiEventOf<"REASONING_MESSAGE_END">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "content",
    content: {
      family: "reasoning",
      occurrence,
      message: {
        nativeMessageId: nativeMessageId(event.messageId),
        nativeContentId: nativeContentId("reasoning", event.messageId),
        agUiMessageId: event.messageId,
      },
    },
  };
}

function stepContext(
  event: AgUiEventOf<"STEP_STARTED" | "STEP_FINISHED">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "content",
    content: {
      family: "step",
      occurrence,
      runid: `native-run:${event.subagentRunId ?? "root"}`,
      step: {
        nativeStepId: nativeStepId(event.stepName),
        agUiStepName: event.stepName,
      },
    },
  };
}

function toolCallNameFor(
  event: AgUiEventOf<"TOOL_CALL_START" | "TOOL_CALL_ARGS" | "TOOL_CALL_END">,
): string {
  return event.type === "TOOL_CALL_START" ? event.toolCallName : "search";
}

function toolCallContext(
  event: AgUiEventOf<"TOOL_CALL_START" | "TOOL_CALL_ARGS" | "TOOL_CALL_END">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  const parent = event.type === "TOOL_CALL_START" && event.parentMessageId !== undefined
    ? {
      nativeMessageId: nativeMessageId(event.parentMessageId),
      agUiMessageId: event.parentMessageId,
    }
    : undefined;
  return {
    family: "tool",
    tool: {
      kind: "call",
      occurrence,
      tool: {
        nativeToolCallId: nativeToolCallId(event.toolCallId),
        nativeToolName: nativeToolName(event.toolCallId, toolCallNameFor(event)),
        agUiToolCallId: event.toolCallId,
        agUiToolCallName: toolCallNameFor(event),
      },
      ...(parent === undefined ? {} : { parent }),
    },
  };
}

function toolResultContext(
  event: AgUiEventOf<"TOOL_CALL_RESULT">,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "tool",
    tool: {
      kind: "result",
      occurrence,
      tool: {
        nativeToolCallId: nativeToolCallId(event.toolCallId),
        nativeToolName: nativeToolName(event.toolCallId, "search"),
        agUiToolCallId: event.toolCallId,
        agUiToolCallName: "search",
      },
      resultMessage: {
        nativeMessageId: nativeMessageId(event.messageId),
        agUiMessageId: event.messageId,
      },
    },
  };
}

function synchronizationContext(
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return { family: "synchronization", synchronization: { occurrence } };
}

function reasoningContext(
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "reasoning",
    reasoning: {
      occurrence,
      runid: "native-run:reasoning-fixture",
      runkind: "agent",
      conversationid: "conversation-fixture",
    },
  };
}

function invocationContext(
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "invocation",
    invocation: {
      occurrence,
      runid: "native-run:invocation-fixture",
      runkind: "agent",
      conversationid: "conversation-fixture",
    },
  };
}

function signalContext(
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext {
  return {
    family: "signal",
    signal: {
      occurrence,
      runid: "native-run:signal-fixture",
      runkind: "agent",
      conversationid: "conversation-fixture",
    },
  };
}

function nativeContextFor(
  event: AgUiEvent,
  occurrence: AgUiProducerOccurrence & { readonly time: string },
): AgUiNativeProfileContext | undefined {
  switch (event.type) {
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
      return textContext(event, occurrence);
    case "TEXT_MESSAGE_CHUNK":
      return undefined;
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
      return toolCallContext(event, occurrence);
    case "TOOL_CALL_CHUNK":
      return undefined;
    case "TOOL_CALL_RESULT":
      return toolResultContext(event, occurrence);
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
    case "MESSAGES_SNAPSHOT":
    case "ACTIVITY_SNAPSHOT":
    case "ACTIVITY_DELTA":
      return synchronizationContext(occurrence);
    case "RAW":
    case "CUSTOM":
      return signalContext(occurrence);
    case "RUN_STARTED":
    case "RUN_FINISHED":
    case "RUN_ERROR":
      return runContext(event, occurrence);
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return stepContext(event, occurrence);
    case "REASONING_START":
    case "REASONING_END":
    case "REASONING_ENCRYPTED_VALUE":
      return reasoningContext(occurrence);
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
      return reasoningMessageContext(event, occurrence);
    case "REASONING_MESSAGE_CHUNK":
      return undefined;
    case "SUBAGENT_STARTED":
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR":
      return invocationContext(occurrence);
  }
}

function reverseProjectionInput(
  command: AgUiNativeProfileEventCommand,
  context: AgUiNativeProfileContext,
) {
  return {
    event: command.event,
    ...(context.family === "content" ? { contentContext: context.content } : {}),
    ...(context.family === "tool" ? { toolContext: context.tool } : {}),
  };
}

function canonicalCommandFor(
  event: AgUiEvent,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProfileContext,
): AgUiNativeProfileEventCommand {
  const result = acceptAgUiEvent({ event, producerOccurrence, nativeProfileContext: context });
  assertEquals(result.accepted.producerOccurrence, producerOccurrence);
  assertEquals(result.accepted.event, event);
  const command = result.commands.find((candidate) => candidate.kind === "canonical-native-event");
  assert(command, `${event.type} did not emit a canonical native event`);
  assertEquals(command.kind, "canonical-native-event");
  assertEquals(command.producerOccurrence, producerOccurrence);
  assertEquals(command.event.source, producerOccurrence.source);
  assertEquals(command.event.id, producerOccurrence.id);
  assertEquals(parseNativeProfileRecord(command.event), command.event);
  return command;
}

function expandedCommands(
  result: ReturnType<typeof acceptAgUiEvent>,
): readonly AgUiExpandedEventCommand[] {
  return result.commands.filter((command) => command.kind === "expanded-ag-ui-event");
}

function expandedEventsFor(events: readonly AgUiEvent[]): readonly AgUiEvent[] {
  let state: AgUiNormalizationState | undefined;
  const output: AgUiEvent[] = [];
  for (const [index, event] of events.entries()) {
    const result = acceptAgUiEvent({
      event,
      producerOccurrence: { source: SOURCE, id: `chunk-sequence-${index}` },
      normalizationState: state,
    });
    assert(!result.commands.some((command) => command.kind === "canonical-native-event"));
    output.push(...expandedCommands(result).map((command) => command.event));
    state = result.normalizationState;
  }
  return output;
}

const fixtures = agUiPositiveFixtures.map((fixture) => parseAgUiEvent(fixture));
const chunks = new Set(["TEXT_MESSAGE_CHUNK", "TOOL_CALL_CHUNK", "REASONING_MESSAGE_CHUNK"]);

describe("events/ag-ui/native-conformance", () => {
  it("covers all 31 released AG-UI event types with positive fixtures", () => {
    const fixtureTypes = new Set(fixtures.map((event) => event.type));
    assertEquals([...fixtureTypes].sort(), [...AG_UI_EVENT_TYPES].sort());
    assertEquals(fixtureTypes.size, 31);
  });

  it("accepts every ordinary positive fixture, validates its native record, and reverses with exact context", () => {
    let ordinaryCount = 0;
    for (const [index, event] of fixtures.entries()) {
      if (chunks.has(event.type)) continue;
      ordinaryCount += 1;
      const occurrence = occurrenceFor(index, event.type);
      const producerOccurrence = { source: occurrence.source, id: occurrence.id };
      const context = nativeContextFor(event, occurrence);
      assert(context, `${event.type} fixture has no native context`);
      const command = canonicalCommandFor(event, producerOccurrence, context);
      assertEquals(projectNativeProfileEvent(reverseProjectionInput(command, context)), event);
    }
    assertEquals(ordinaryCount, agUiPositiveFixtures.length - 3);
  });

  it("expands shorthand fixtures deterministically as ordered read frames without native occurrence facts", () => {
    const textChunk = parseAgUiEvent({
      type: "TEXT_MESSAGE_CHUNK",
      messageId: "msg-chunk",
      role: "user",
      delta: "chunk",
      name: "person",
    });
    const reasoningChunk = parseAgUiEvent({
      type: "REASONING_MESSAGE_CHUNK",
      messageId: "reason-msg-2",
      delta: "compact thought",
    });
    const toolChunk = parseAgUiEvent({
      type: "TOOL_CALL_CHUNK",
      toolCallId: "tool-2",
      toolCallName: "lookup",
      parentMessageId: "msg-text",
      delta: '{"id":"a"}',
    });
    const terminal = parseAgUiEvent({ type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" });

    const sequence = [textChunk, reasoningChunk, toolChunk, terminal];
    const expected = [
      parseAgUiEvent({
        type: "TEXT_MESSAGE_START",
        messageId: "msg-chunk",
        role: "user",
        name: "person",
      }),
      parseAgUiEvent({ type: "TEXT_MESSAGE_CONTENT", messageId: "msg-chunk", delta: "chunk" }),
      parseAgUiEvent({ type: "TEXT_MESSAGE_END", messageId: "msg-chunk" }),
      parseAgUiEvent({
        type: "REASONING_MESSAGE_START",
        messageId: "reason-msg-2",
        role: "reasoning",
      }),
      parseAgUiEvent({
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "reason-msg-2",
        delta: "compact thought",
      }),
      parseAgUiEvent({ type: "REASONING_MESSAGE_END", messageId: "reason-msg-2" }),
      parseAgUiEvent({
        type: "TOOL_CALL_START",
        toolCallId: "tool-2",
        toolCallName: "lookup",
        parentMessageId: "msg-text",
      }),
      parseAgUiEvent({ type: "TOOL_CALL_ARGS", toolCallId: "tool-2", delta: '{"id":"a"}' }),
      parseAgUiEvent({ type: "TOOL_CALL_END", toolCallId: "tool-2" }),
    ];

    assertEquals(expandedEventsFor(sequence), expected);
    assertEquals(expandedEventsFor(sequence), expected);
  });

  it("binds native profile context to the accepted source/id and keeps retry expansion IDs stable", () => {
    const event = parseAgUiEvent({ type: "CUSTOM", name: "app.signal", value: { ok: true } });
    const occurrence = occurrenceFor(100, event.type);
    const context = nativeContextFor(event, occurrence);
    assert(context, "CUSTOM fixture has no native context");
    assertThrows(
      () =>
        acceptAgUiEvent({
          event,
          producerOccurrence: { source: occurrence.source, id: "different-id" },
          nativeProfileContext: context,
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );

    const chunk = parseAgUiEvent({
      type: "TEXT_MESSAGE_CHUNK",
      messageId: "retry-msg",
      delta: "a",
    });
    const first = acceptAgUiEvent({
      event: chunk,
      producerOccurrence: { source: "urn:a#b", id: "c" },
    });
    const retry = acceptAgUiEvent({
      event: chunk,
      producerOccurrence: { source: "urn:a#b", id: "c" },
    });
    const collision = acceptAgUiEvent({
      event: chunk,
      producerOccurrence: { source: "urn:a", id: "b#c" },
    });
    const firstExpansion = expandedCommands(first)[0];
    const retryExpansion = expandedCommands(retry)[0];
    const collisionExpansion = expandedCommands(collision)[0];
    assert(firstExpansion);
    assert(retryExpansion);
    assert(collisionExpansion);
    assertEquals(firstExpansion.expansionId, retryExpansion.expansionId);
    assert(firstExpansion.expansionId !== collisionExpansion.expansionId);
    assert(!first.commands.some((command) => command.kind === "canonical-native-event"));
    assert(!retry.commands.some((command) => command.kind === "canonical-native-event"));
    assert(!collision.commands.some((command) => command.kind === "canonical-native-event"));
  });
});
