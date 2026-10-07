import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agUiNegativeFixtures, agUiPositiveFixtures } from "./fixtures.mjs";
import type { EventRecord, EventType } from "#veryfront/events/types.ts";
import { EVENT_SCHEMA_BY_TYPE } from "#veryfront/events/types.ts";
import { parseEvent } from "#veryfront/events/parser.ts";
import {
  acceptAgUiEvent,
  acceptNativeEvent,
  AG_UI_CORE_PACKAGE,
  AG_UI_CORE_VERSION,
  AG_UI_EVENT_TYPES,
  AG_UI_PROTOCOL_VERSION,
  AG_UI_RELEASE,
  AG_UI_RELEASE_COMMIT,
  type AgUiEvent,
  type AgUiNativeProjectionContext,
  type AgUiNormalizationCommand,
  type AgUiNormalizationState,
  projectNativeEvent,
  projectNativeProfileEvent,
  safeParseAgUiEvent,
} from "#veryfront/events/ag-ui/index.ts";

function nativeEvent(
  id: string,
  type: EventType,
  data: Record<string, unknown>,
  envelope: Record<string, unknown> = {},
): EventRecord {
  return parseEvent({
    specversion: "1.0",
    id,
    source: "https://example.test/native",
    type,
    datacontenttype: "application/json",
    dataschema: EVENT_SCHEMA_BY_TYPE[type],
    data,
    ...envelope,
  });
}

function nativeProjectionEvents(
  events: readonly EventRecord[],
  projectionContext: AgUiNativeProjectionContext,
): readonly AgUiEvent[] {
  const projected: AgUiEvent[] = [];
  events.forEach((event) => {
    const commands = projectNativeEvent({
      event,
      projectionContext,
    });
    assertEquals(commands.length, 1);
    const command = commands[0];
    assertEquals(command?.kind, "expanded-ag-ui-event");
    if (command?.kind !== "expanded-ag-ui-event") return;
    assertEquals(command.producerOccurrence, { source: event.source, id: event.id });
    assertEquals(command.expansionId, `${JSON.stringify([event.source, event.id])}:0`);
    projected.push(command.event);
  });
  return projected;
}

function firstRequirement(commands: readonly AgUiNormalizationCommand[]): string | undefined {
  const command = commands.find((candidate) => candidate.kind === "missing-fact-requirement");
  return command?.kind === "missing-fact-requirement" ? command.requirement : undefined;
}
function expandedEventsFor(events: readonly unknown[]): readonly AgUiEvent[] {
  let normalizationState: AgUiNormalizationState | undefined;
  const expanded: AgUiEvent[] = [];
  events.forEach((event, index) => {
    const result = acceptAgUiEvent({
      event,
      producerOccurrence: { source: "test", id: `event-${index}` },
      normalizationState,
    });
    normalizationState = result.normalizationState;
    for (const command of result.commands) {
      if (command.kind === "expanded-ag-ui-event") expanded.push(command.event);
    }
  });
  return expanded;
}

describe("events/ag-ui/parser", () => {
  it("keeps null run input state replayable through native normalization", () => {
    const event = {
      type: "RUN_STARTED",
      threadId: "thread",
      runId: "run",
      input: { threadId: "thread", runId: "run", messages: [], state: null },
    };
    const parsed = safeParseAgUiEvent(event);
    assert(parsed.success);
    assertEquals(safeParseAgUiEvent(parsed.data), parsed);
    assert(parsed.data.type === "RUN_STARTED" && parsed.data.input !== undefined);
    assertEquals(Object.hasOwn(parsed.data.input, "state"), false);
    assertEquals(event.input.state, null);
    const occurrence = { source: "/runs/canonical-run", id: "accepted-occurrence" };
    const accepted = acceptAgUiEvent({
      event: parsed.data,
      producerOccurrence: occurrence,
      nativeProfileContext: {
        family: "run",
        run: {
          occurrence,
          runid: "canonical-run",
          agui: { threadId: "thread", runId: "run" },
        },
      },
    });
    assert(accepted.commands.some((command) => command.kind === "canonical-native-event"));
  });

  it("roundtrips empty AG-UI thread and run IDs through public native profile acceptance", () => {
    const event: AgUiEvent = {
      type: "RUN_STARTED",
      threadId: "",
      runId: "",
    };
    const occurrence = { source: "/runs/native-run-empty-agui", id: "accepted-empty-run" };
    const accepted = acceptAgUiEvent({
      event,
      producerOccurrence: occurrence,
      nativeProfileContext: {
        family: "run",
        run: {
          occurrence,
          runid: "native-run-empty-agui",
          agui: { threadId: "", runId: "" },
        },
      },
    });
    const command = accepted.commands.find((candidate) =>
      candidate.kind === "canonical-native-event"
    );
    assert(command?.kind === "canonical-native-event");
    assertEquals(command.event.type, "com.veryfront.run.started");
    if (command.event.type !== "com.veryfront.run.started") return;
    assertEquals(command.event.runid, "native-run-empty-agui");
    assertEquals(projectNativeProfileEvent({ event: command.event }), event);
  });

  it("pins the AG-UI 1.0 release provenance", () => {
    assertEquals(AG_UI_CORE_PACKAGE, "@ag-ui/core");
    assertEquals(AG_UI_CORE_VERSION, "1.0.2");
    assertEquals(AG_UI_PROTOCOL_VERSION, "1.0");
    assertEquals(AG_UI_RELEASE, "release/2026-10-05");
    assertEquals(AG_UI_RELEASE_COMMIT, "e776b21027bef590905fb75f004e995dbe0941f4");
  });

  it("declares the 31 released AG-UI 1.0 event types", () => {
    assertEquals(AG_UI_EVENT_TYPES.length, 31);
    assertEquals(new Set(AG_UI_EVENT_TYPES).size, 31);
    assert(AG_UI_EVENT_TYPES.includes("ACTIVITY_SNAPSHOT"));
    assert(AG_UI_EVENT_TYPES.includes("REASONING_ENCRYPTED_VALUE"));
    assert(AG_UI_EVENT_TYPES.includes("SUBAGENT_STARTED"));
  });

  it("accepts every positive AG-UI fixture", () => {
    const fixtureTypes = new Set(agUiPositiveFixtures.map((event) => event.type));
    assertEquals([...fixtureTypes].sort(), [...AG_UI_EVENT_TYPES].sort());
    for (const event of agUiPositiveFixtures) {
      const result = safeParseAgUiEvent(event);
      assert(result.success, `${event.type} unexpectedly failed local AG-UI validation`);
    }
  });

  it("rejects negative AG-UI fixtures", () => {
    for (const fixture of agUiNegativeFixtures) {
      const result = safeParseAgUiEvent(fixture.event);
      assert(!result.success, `${fixture.id} unexpectedly parsed`);
    }
  });

  it("emits explicit requirements instead of silently projecting missing target facts", () => {
    const result = acceptAgUiEvent({
      event: {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-1",
        outcome: {
          type: "interrupt",
          interrupts: [{ id: "interrupt-1", reason: "approval" }],
        },
      },
      producerOccurrence: { source: "oracle", id: "run-finished-interrupt" },
    });

    assertEquals(result.accepted.event.type, "RUN_FINISHED");
    assertEquals(result.commands[0]?.kind, "accepted-ag-ui-event");
    assertEquals(result.commands[1]?.kind, "missing-fact-requirement");
    assertEquals(
      result.commands[1]?.kind === "missing-fact-requirement" &&
        result.commands[1].requirement,
      "native-run-suspension-outcome",
    );
  });

  it("expands successive text chunks as one open stream and closes on run terminal", () => {
    const expanded = expandedEventsFor([
      { type: "TEXT_MESSAGE_CHUNK", messageId: "msg-1", delta: "hel" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "lo" },
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
    ]);

    assertEquals(expanded, [
      { type: "TEXT_MESSAGE_START", messageId: "msg-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", delta: "hel" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg-1", delta: "lo" },
      { type: "TEXT_MESSAGE_END", messageId: "msg-1" },
    ]);
    for (const event of expanded) assert(safeParseAgUiEvent(event).success);
  });

  it("uses unambiguous producer occurrence tuple keys for expansion IDs", () => {
    const event = { type: "TEXT_MESSAGE_CHUNK", messageId: "msg", delta: "hello" } as const;
    const first = acceptAgUiEvent({
      event,
      producerOccurrence: { source: "urn:a#b", id: "c" },
    });
    const second = acceptAgUiEvent({
      event,
      producerOccurrence: { source: "urn:a", id: "b#c" },
    });
    const retry = acceptAgUiEvent({
      event,
      producerOccurrence: { source: "urn:a#b", id: "c" },
    });

    const firstExpansion = first.commands.find((command) =>
      command.kind === "expanded-ag-ui-event"
    );
    const secondExpansion = second.commands.find((command) =>
      command.kind === "expanded-ag-ui-event"
    );
    const retryExpansion = retry.commands.find((command) =>
      command.kind === "expanded-ag-ui-event"
    );

    assertEquals(firstExpansion?.kind, "expanded-ag-ui-event");
    assertEquals(secondExpansion?.kind, "expanded-ag-ui-event");
    assertEquals(retryExpansion?.kind, "expanded-ag-ui-event");
    if (
      firstExpansion?.kind !== "expanded-ag-ui-event" ||
      secondExpansion?.kind !== "expanded-ag-ui-event" ||
      retryExpansion?.kind !== "expanded-ag-ui-event"
    ) return;

    assertEquals(firstExpansion.ordinal, secondExpansion.ordinal);
    assert(firstExpansion.expansionId !== secondExpansion.expansionId);
    assertEquals(firstExpansion.expansionId, `${JSON.stringify(["urn:a#b", "c"])}:0`);
    assertEquals(secondExpansion.expansionId, `${JSON.stringify(["urn:a", "b#c"])}:0`);
    assertEquals(retryExpansion.expansionId, firstExpansion.expansionId);
  });

  it("rejects empty producer occurrence source or id at the accept boundary", () => {
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TEXT_MESSAGE_CONTENT", messageId: "msg", delta: "hello" },
          producerOccurrence: { source: "", id: "event" },
        }),
      TypeError,
      "source must be a non-empty",
    );
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TEXT_MESSAGE_CONTENT", messageId: "msg", delta: "hello" },
          producerOccurrence: { source: "urn:test", id: "" },
        }),
      TypeError,
      "id must be non-empty",
    );
  });

  it("requires context instead of fabricating omitted first chunk identity", () => {
    const result = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", delta: "hello" },
      producerOccurrence: { source: "producer", id: "text-chunk-1" },
    });

    assertEquals(result.commands[1]?.kind, "missing-fact-requirement");
    assertEquals(
      result.commands[1]?.kind === "missing-fact-requirement" &&
        result.commands[1].requirement,
      "unambiguous-shorthand-context",
    );
  });

  it("keeps interleaved invocation lanes independent", () => {
    const expanded = expandedEventsFor([
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-a", messageId: "a", delta: "a1" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-b", messageId: "b", delta: "b1" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-a", delta: "a2" },
      { type: "TEXT_MESSAGE_CHUNK", subagentRunId: "sub-b", delta: "b2" },
      { type: "RUN_ERROR", message: "stop" },
    ]);

    assertEquals(expanded, [
      { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "a1", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_START", messageId: "b", role: "assistant", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "b1", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "a2", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "b2", subagentRunId: "sub-b" },
      { type: "TEXT_MESSAGE_END", messageId: "a", subagentRunId: "sub-a" },
      { type: "TEXT_MESSAGE_END", messageId: "b", subagentRunId: "sub-b" },
    ]);
  });

  it("keeps an open text stream when an invalid first tool chunk is rejected", () => {
    const normalizationState: AgUiNormalizationState | undefined = undefined;
    const first = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", messageId: "msg-open", delta: "a" },
      producerOccurrence: { source: "test", id: "text-open" },
      normalizationState,
    });
    const invalidTool = acceptAgUiEvent({
      event: { type: "TOOL_CALL_CHUNK", toolCallId: "tool-missing-name", delta: "{}" },
      producerOccurrence: { source: "test", id: "tool-invalid" },
      normalizationState: first.normalizationState,
    });
    assertEquals(firstRequirement(invalidTool.commands), "unambiguous-shorthand-context");
    assertEquals(invalidTool.normalizationState, first.normalizationState);

    const continued = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", delta: "b" },
      producerOccurrence: { source: "test", id: "text-continues" },
      normalizationState: invalidTool.normalizationState,
    });

    assertEquals(
      continued.commands
        .filter((command) => command.kind === "expanded-ag-ui-event")
        .map((command) => command.kind === "expanded-ag-ui-event" && command.event),
      [{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg-open", delta: "b" }],
    );
  });

  it("streams reasoning and tool chunks without inventing per-chunk end events", () => {
    const expanded = expandedEventsFor([
      { type: "REASONING_MESSAGE_CHUNK", messageId: "reason-1", delta: "r1" },
      { type: "REASONING_MESSAGE_CHUNK", delta: "r2" },
      { type: "TOOL_CALL_CHUNK", toolCallId: "tool-1", toolCallName: "lookup", delta: '{"a"' },
      { type: "TOOL_CALL_CHUNK", delta: ":1}" },
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
    ]);

    assertEquals(expanded, [
      { type: "REASONING_MESSAGE_START", messageId: "reason-1", role: "reasoning" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "reason-1", delta: "r1" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "reason-1", delta: "r2" },
      { type: "REASONING_MESSAGE_END", messageId: "reason-1" },
      { type: "TOOL_CALL_START", toolCallId: "tool-1", toolCallName: "lookup" },
      { type: "TOOL_CALL_ARGS", toolCallId: "tool-1", delta: '{"a"' },
      { type: "TOOL_CALL_ARGS", toolCallId: "tool-1", delta: ":1}" },
      { type: "TOOL_CALL_END", toolCallId: "tool-1" },
    ]);
  });

  it("replays chunk expansion deterministically with explicit state", () => {
    const input = [
      { type: "TEXT_MESSAGE_CHUNK", messageId: "msg-1", delta: "a" },
      { type: "TEXT_MESSAGE_CHUNK", delta: "b" },
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
    ];
    assertEquals(expandedEventsFor(input), expandedEventsFor(input));
  });

  it("projects verified native events to AG-UI with persisted identity context", () => {
    const projectionContext: AgUiNativeProjectionContext = {
      run: { threadId: "thread-agui" },
      messages: [
        {
          kind: "text",
          nativeMessageId: "native-msg",
          nativeContentId: "text-1",
          agUiMessageId: "agui-msg",
        },
        {
          kind: "reasoning",
          nativeMessageId: "native-reason",
          nativeContentId: "reason-1",
          agUiMessageId: "agui-reason",
        },
      ],
      toolCalls: [
        {
          nativeToolCallId: "native-tool",
          agUiToolCallId: "agui-tool",
          resultMessageId: "agui-tool-result",
        },
      ],
      steps: [{ nativeStepId: "native-step", agUiStepName: "Plan" }],
    };
    const events = [
      nativeEvent("run-start", "com.veryfront.run.started", {}, { runid: "run-native" }),
      nativeEvent("step-start", "com.veryfront.step.started", { stepId: "native-step" }, {
        runid: "run-native",
      }),
      nativeEvent("text-start", "com.veryfront.message.text.started", {
        messageId: "native-msg",
        contentId: "text-1",
        role: "assistant",
      }),
      nativeEvent("text-delta", "com.veryfront.message.text.delta.emitted", {
        messageId: "native-msg",
        contentId: "text-1",
        delta: "Hello",
      }),
      nativeEvent("text-end", "com.veryfront.message.text.ended", {
        messageId: "native-msg",
        contentId: "text-1",
      }),
      nativeEvent("reason-start", "com.veryfront.message.reasoning.started", {
        messageId: "native-reason",
        contentId: "reason-1",
      }),
      nativeEvent("reason-delta", "com.veryfront.message.reasoning.delta.emitted", {
        messageId: "native-reason",
        contentId: "reason-1",
        delta: "thinking",
      }),
      nativeEvent("reason-end", "com.veryfront.message.reasoning.ended", {
        messageId: "native-reason",
        contentId: "reason-1",
      }),
      nativeEvent("tool-start", "com.veryfront.tool-call.started", {
        toolCallId: "native-tool",
        toolName: "lookup",
        messageId: "native-msg",
      }),
      nativeEvent("tool-args", "com.veryfront.tool-call.arguments.delta.emitted", {
        toolCallId: "native-tool",
        delta: '{"q":"x"}',
      }),
      nativeEvent("tool-end", "com.veryfront.tool-call.arguments.ended", {
        toolCallId: "native-tool",
      }),
      nativeEvent("tool-result", "com.veryfront.tool-call.result.recorded", {
        toolCallId: "native-tool",
        output: "result text",
      }),
      nativeEvent("step-end", "com.veryfront.step.ended", { stepId: "native-step" }, {
        runid: "run-native",
      }),
      nativeEvent("run-finish", "com.veryfront.run.succeeded", {}, { runid: "run-native" }),
    ];

    assertEquals(nativeProjectionEvents(events, projectionContext), [
      { type: "RUN_STARTED", threadId: "thread-agui", runId: "run-native" },
      { type: "STEP_STARTED", stepName: "Plan" },
      { type: "TEXT_MESSAGE_START", messageId: "agui-msg", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "agui-msg", delta: "Hello" },
      { type: "TEXT_MESSAGE_END", messageId: "agui-msg" },
      { type: "REASONING_MESSAGE_START", messageId: "agui-reason", role: "reasoning" },
      { type: "REASONING_MESSAGE_CONTENT", messageId: "agui-reason", delta: "thinking" },
      { type: "REASONING_MESSAGE_END", messageId: "agui-reason" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "agui-tool",
        toolCallName: "lookup",
        parentMessageId: "agui-msg",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "agui-tool", delta: '{"q":"x"}' },
      { type: "TOOL_CALL_END", toolCallId: "agui-tool" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "agui-tool",
        messageId: "agui-tool-result",
        content: "result text",
        role: "tool",
      },
      { type: "STEP_FINISHED", stepName: "Plan" },
      {
        type: "RUN_FINISHED",
        threadId: "thread-agui",
        runId: "run-native",
        outcome: { type: "success" },
      },
    ]);
  });

  it("accepts native envelopes through validation before projection", () => {
    const nativeInput = {
      event: {
        specversion: "1.0",
        id: "text-delta-envelope",
        source: "https://example.test/native",
        type: "com.veryfront.message.text.delta.emitted",
        datacontenttype: "application/json",
        dataschema: EVENT_SCHEMA_BY_TYPE["com.veryfront.message.text.delta.emitted"],
        data: { messageId: "native-msg", contentId: "text-1", delta: "Hi" },
      },
      producerOccurrence: { source: "forged", id: "forged" },
      projectionContext: {
        messages: [
          {
            kind: "text",
            nativeMessageId: "native-msg",
            nativeContentId: "text-1",
            agUiMessageId: "agui-msg",
          },
        ],
      },
    } as const;
    const command = acceptNativeEvent(nativeInput)[0];

    assertEquals(command?.kind, "expanded-ag-ui-event");
    assertEquals(command?.producerOccurrence, {
      source: "https://example.test/native",
      id: "text-delta-envelope",
    });
    assertEquals(
      command?.kind === "expanded-ag-ui-event" && command.expansionId,
      `${JSON.stringify(["https://example.test/native", "text-delta-envelope"])}:0`,
    );
    assertEquals(command?.kind === "expanded-ag-ui-event" && command.event, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "agui-msg",
      delta: "Hi",
    });
  });

  it("returns explicit requirements for missing projection context and unsupported native semantics", () => {
    assertEquals(
      firstRequirement(projectNativeEvent({
        event: nativeEvent("missing-text", "com.veryfront.message.text.delta.emitted", {
          messageId: "native-msg",
          contentId: "text-1",
          delta: "Hi",
        }),
      })),
      "native-ag-ui-projection-context",
    );

    assertEquals(
      firstRequirement(projectNativeEvent({
        event: nativeEvent("status", "com.veryfront.tool-call.status.reported", {
          toolCallId: "native-tool",
          status: "running",
        }),
      })),
      "native-lossy-target-event",
    );

    assertEquals(
      firstRequirement(projectNativeEvent({
        event: nativeEvent("redacted", "com.veryfront.message.reasoning.delta.emitted", {
          messageId: "native-reason",
          contentId: "reason-1",
          contentRedacted: true,
        }),
        projectionContext: {
          messages: [{
            kind: "reasoning",
            nativeMessageId: "native-reason",
            nativeContentId: "reason-1",
            agUiMessageId: "agui-reason",
          }],
        },
      })),
      "native-lossy-target-event",
    );
  });
});
