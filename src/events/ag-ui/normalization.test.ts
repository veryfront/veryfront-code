import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  acceptAgUiEvent,
  type AgUiNativeProfileContext,
  type AgUiNativeProfileRecord,
  type AgUiNormalizationCommand,
  type AgUiProducerOccurrence,
} from "#veryfront/events/ag-ui/index.ts";

const occurrence = {
  source: "https://example.test/ag-ui/normalization",
  id: "normalization-occurrence-1",
  time: "2026-10-06T12:00:00.000Z",
} as const;

const producerOccurrence: AgUiProducerOccurrence = {
  source: occurrence.source,
  id: occurrence.id,
};

const runContext: AgUiNativeProfileContext = {
  family: "run",
  run: {
    occurrence,
    runid: "native-run-1",
    agui: { threadId: "thread-1", runId: "run-1" },
    runkind: "agent",
    conversationid: "conversation-1",
  },
} as const;

const synchronizationContext: AgUiNativeProfileContext = {
  family: "synchronization",
  synchronization: { occurrence },
} as const;

const reasoningContext: AgUiNativeProfileContext = {
  family: "reasoning",
  reasoning: {
    occurrence,
    runid: "native-run-1",
    runkind: "agent",
    conversationid: "conversation-1",
  },
} as const;

const invocationContext: AgUiNativeProfileContext = {
  family: "invocation",
  invocation: {
    occurrence,
    runid: "native-run-1",
    runkind: "agent",
    conversationid: "conversation-1",
  },
} as const;

const signalContext: AgUiNativeProfileContext = {
  family: "signal",
  signal: {
    occurrence,
    runid: "native-run-1",
    runkind: "agent",
    conversationid: "conversation-1",
  },
} as const;

const textContentContext: AgUiNativeProfileContext = {
  family: "content",
  content: {
    family: "text",
    occurrence,
    message: {
      nativeMessageId: "native-message-1",
      nativeContentId: "native-content-text-1",
      agUiMessageId: "agui-message-1",
    },
  },
} as const;

const reasoningContentContext: AgUiNativeProfileContext = {
  family: "content",
  content: {
    family: "reasoning",
    occurrence,
    message: {
      nativeMessageId: "native-message-1",
      nativeContentId: "native-content-reasoning-1",
      agUiMessageId: "agui-reasoning-1",
    },
  },
} as const;

const stepContentContext: AgUiNativeProfileContext = {
  family: "content",
  content: {
    family: "step",
    occurrence,
    runid: "native-run-1",
    step: { nativeStepId: "native-step-1", agUiStepName: "Plan" },
  },
} as const;

const toolResultMessage = {
  nativeMessageId: "native-result-message-1",
  agUiMessageId: "agui-result-message-1",
} as const;

const toolCallContext: AgUiNativeProfileContext = {
  family: "tool",
  tool: {
    kind: "call",
    occurrence,
    tool: {
      nativeToolCallId: "native-tool-1",
      nativeToolName: "native.search",
      agUiToolCallId: "agui-tool-1",
      agUiToolCallName: "search",
    },
    parent: {
      nativeMessageId: "native-parent-message-1",
      agUiMessageId: "agui-parent-message-1",
    },
  },
} as const;

const toolResultContext: AgUiNativeProfileContext = {
  family: "tool",
  tool: {
    kind: "result",
    occurrence,
    tool: toolCallContext.tool.tool,
    resultMessage: toolResultMessage,
  },
} as const;

function firstRequirement(commands: readonly AgUiNormalizationCommand[]): string | undefined {
  const command = commands.find((candidate) => candidate.kind === "missing-fact-requirement");
  return command?.kind === "missing-fact-requirement" ? command.requirement : undefined;
}

function canonicalCommands(
  commands: readonly AgUiNormalizationCommand[],
): readonly Extract<AgUiNormalizationCommand, { readonly kind: "canonical-native-event" }>[] {
  return commands.filter((command) => command.kind === "canonical-native-event");
}

function expandedCommands(
  commands: readonly AgUiNormalizationCommand[],
): readonly Extract<AgUiNormalizationCommand, { readonly kind: "expanded-ag-ui-event" }>[] {
  return commands.filter((command) => command.kind === "expanded-ag-ui-event");
}

function expansionIdFor(
  source: AgUiProducerOccurrence["source"],
  id: AgUiProducerOccurrence["id"],
  ordinal: number,
): string {
  return `${JSON.stringify([source, id])}:${ordinal}`;
}

function expectedExpansionId(ordinal: number): string {
  return expansionIdFor(producerOccurrence.source, producerOccurrence.id, ordinal);
}

function missingCommands(
  commands: readonly AgUiNormalizationCommand[],
): readonly Extract<AgUiNormalizationCommand, { readonly kind: "missing-fact-requirement" }>[] {
  return commands.filter((command) => command.kind === "missing-fact-requirement");
}

function canonicalRecordFor(
  event: unknown,
  nativeProfileContext: AgUiNativeProfileContext,
): AgUiNativeProfileRecord {
  const result = acceptAgUiEvent({ event, producerOccurrence, nativeProfileContext });
  assertEquals(result.commands[0]?.kind, "accepted-ag-ui-event");
  const command = result.commands.find((candidate) => candidate.kind === "canonical-native-event");
  assert(command, "expected a canonical native profile command");
  assertEquals(command.kind, "canonical-native-event");
  assertEquals(command.producerOccurrence, producerOccurrence);
  assertEquals(command.event.source, producerOccurrence.source);
  assertEquals(command.event.id, producerOccurrence.id);
  return command.event;
}

describe("events/ag-ui/normalization native profile integration", () => {
  it("keeps parent and sibling shorthand streams open at child run boundaries", () => {
    const boundaries = [
      { type: "RUN_STARTED", threadId: "thread-1", runId: "child", subagentRunId: "child" },
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "child", subagentRunId: "child" },
      { type: "RUN_ERROR", message: "failed", subagentRunId: "child" },
      { type: "MESSAGES_SNAPSHOT", messages: [], subagentRunId: "child" },
    ] satisfies Parameters<typeof acceptAgUiEvent>[0]["event"][];

    for (const event of boundaries) {
      const parent = acceptAgUiEvent({
        event: { type: "TEXT_MESSAGE_CHUNK", messageId: "parent-message", delta: "parent" },
        producerOccurrence,
      });
      const sibling = acceptAgUiEvent({
        event: {
          type: "TEXT_MESSAGE_CHUNK",
          messageId: "sibling-message",
          subagentRunId: "sibling",
          delta: "sibling",
        },
        producerOccurrence,
        normalizationState: parent.normalizationState,
      });
      const child = acceptAgUiEvent({
        event: {
          type: "TEXT_MESSAGE_CHUNK",
          messageId: "child-message",
          subagentRunId: "child",
          delta: "child",
        },
        producerOccurrence,
        normalizationState: sibling.normalizationState,
      });
      const boundary = acceptAgUiEvent({
        event,
        producerOccurrence,
        normalizationState: child.normalizationState,
      });
      const closed = boundary.commands.filter((command) => command.kind === "expanded-ag-ui-event");
      assertEquals(closed.map((command) => command.event), [{
        type: "TEXT_MESSAGE_END",
        messageId: "child-message",
        subagentRunId: "child",
      }]);
      assertEquals(boundary.normalizationState.pendingStreams.length, 2);
      const resumed = acceptAgUiEvent({
        event: { type: "TEXT_MESSAGE_CHUNK", messageId: "parent-message", delta: " continued" },
        producerOccurrence,
        normalizationState: boundary.normalizationState,
      });
      const resumedFrames = resumed.commands.filter((command) =>
        command.kind === "expanded-ag-ui-event"
      );
      assertEquals(resumedFrames.map((command) => command.event), [{
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "parent-message",
        delta: " continued",
      }]);
    }
  });

  it("resolves ID-less parent chunks inside the parent lane when child lanes are open", () => {
    const parent = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", messageId: "parent-message", delta: "p1" },
      producerOccurrence: { source: "test", id: "parent-start" },
    });
    const child = acceptAgUiEvent({
      event: {
        type: "TEXT_MESSAGE_CHUNK",
        subagentRunId: "child",
        messageId: "child-message",
        delta: "c1",
      },
      producerOccurrence: { source: "test", id: "child-start" },
      normalizationState: parent.normalizationState,
    });

    const continued = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", delta: "p2" },
      producerOccurrence: { source: "test", id: "parent-continued" },
      normalizationState: child.normalizationState,
    });

    assertEquals(missingCommands(continued.commands), []);
    assertEquals(expandedCommands(continued.commands).map((command) => command.event), [{
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "parent-message",
      delta: "p2",
    }]);
    assertEquals(
      continued.normalizationState.pendingStreams,
      child.normalizationState.pendingStreams,
    );
  });

  it("preserves producer timestamps in shorthand start and content frames", () => {
    const events = [
      { type: "TEXT_MESSAGE_CHUNK", messageId: "message-1", delta: "text", timestamp: 123 },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tool-1",
        toolCallName: "search",
        delta: "{}",
        timestamp: 123,
      },
      {
        type: "REASONING_MESSAGE_CHUNK",
        messageId: "reasoning-1",
        delta: "reason",
        timestamp: 123,
      },
    ] satisfies Parameters<typeof acceptAgUiEvent>[0]["event"][];

    for (const event of events) {
      const result = acceptAgUiEvent({ event, producerOccurrence });
      const frames = result.commands.filter((command) => command.kind === "expanded-ag-ui-event");
      assertEquals(frames.length, 2);
      assertEquals(frames.map((frame) => frame.event.timestamp), [123, 123]);
    }
  });

  it("projects shorthand text chunks through derived native frame identities when explicit context is present", () => {
    const result = acceptAgUiEvent({
      event: {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "agui-message-1",
        role: "assistant",
        delta: "hello",
      },
      producerOccurrence,
      nativeProfileContext: textContentContext,
    });

    const expanded = expandedCommands(result.commands);
    assertEquals(expanded.map((command) => command.expansionId), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.producerOccurrence.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.type), [
      "com.veryfront.message.text.started",
      "com.veryfront.message.text.delta.emitted",
    ]);
  });

  it("projects shorthand reasoning chunks through derived native frame identities when explicit context is present", () => {
    const result = acceptAgUiEvent({
      event: {
        type: "REASONING_MESSAGE_CHUNK",
        messageId: "agui-reasoning-1",
        delta: "thinking",
      },
      producerOccurrence,
      nativeProfileContext: reasoningContentContext,
    });

    const expanded = expandedCommands(result.commands);
    assertEquals(expanded.map((command) => command.expansionId), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.producerOccurrence.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.type), [
      "com.veryfront.message.reasoning.started",
      "com.veryfront.message.reasoning.delta.emitted",
    ]);
  });

  it("projects shorthand tool chunks through derived native frame identities when explicit context is present", () => {
    const result = acceptAgUiEvent({
      event: {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "agui-tool-1",
        toolCallName: "search",
        parentMessageId: "agui-parent-message-1",
        delta: '{"query":"docs"}',
      },
      producerOccurrence,
      nativeProfileContext: toolCallContext,
    });

    const expanded = expandedCommands(result.commands);
    assertEquals(expanded.map((command) => command.expansionId), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.producerOccurrence.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.id), [
      expectedExpansionId(0),
      expectedExpansionId(1),
    ]);
    assertEquals(canonical.map((command) => command.event.type), [
      "com.veryfront.tool-call.started",
      "com.veryfront.tool-call.arguments.delta.emitted",
    ]);
  });

  it("reports exact native context requirements for closures generated by a run boundary", () => {
    const initial = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", messageId: "agui-message-1", delta: "text" },
      producerOccurrence,
      nativeProfileContext: textContentContext,
    });
    assertEquals(canonicalCommands(initial.commands).map((command) => command.event.type), [
      "com.veryfront.message.text.started",
      "com.veryfront.message.text.delta.emitted",
    ]);
    const checkpoint = structuredClone(initial.normalizationState);
    const boundaryOccurrence = { source: producerOccurrence.source, id: "run-boundary" };
    const result = acceptAgUiEvent({
      event: { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
      producerOccurrence: boundaryOccurrence,
      normalizationState: initial.normalizationState,
      nativeProfileContext: {
        family: "run",
        run: { ...runContext.run, occurrence: boundaryOccurrence },
      },
    });
    const expanded = expandedCommands(result.commands);
    assertEquals(expanded.map((command) => command.event), [
      { type: "TEXT_MESSAGE_END", messageId: "agui-message-1" },
    ]);
    assertEquals(
      missingCommands(result.commands).map((command) => ({
        occurrence: command.producerOccurrence,
        requirement: command.requirement,
      })),
      [{
        occurrence: { source: boundaryOccurrence.source, id: expanded[0]?.expansionId },
        requirement: "native-ag-ui-projection-context",
      }],
    );
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.event.type), ["com.veryfront.run.succeeded"]);
    assertEquals(canonical.map((command) => command.event.id), [boundaryOccurrence.id]);
    assertEquals(initial.normalizationState, checkpoint);
    assertEquals(result.normalizationState, { pendingStreams: [] });
  });

  it("reports each text, reasoning and tool closure without creating native closure identities", () => {
    const text = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", messageId: "agui-message-1", delta: "text" },
      producerOccurrence,
      nativeProfileContext: textContentContext,
    });
    const reasoning = acceptAgUiEvent({
      event: {
        type: "REASONING_MESSAGE_CHUNK",
        messageId: "agui-reasoning-1",
        subagentRunId: "reasoning-lane",
        delta: "reasoning",
      },
      producerOccurrence,
      normalizationState: text.normalizationState,
      nativeProfileContext: reasoningContentContext,
    });
    const tool = acceptAgUiEvent({
      event: {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "agui-tool-1",
        subagentRunId: "tool-lane",
        toolCallName: "search",
        delta: "{}",
      },
      producerOccurrence,
      normalizationState: reasoning.normalizationState,
      nativeProfileContext: toolCallContext,
    });
    const checkpoint = structuredClone(tool.normalizationState);
    const input = {
      event: { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
      producerOccurrence,
      normalizationState: tool.normalizationState,
      nativeProfileContext: runContext,
    };
    const result = acceptAgUiEvent(input);
    assertEquals(expandedCommands(result.commands).map((command) => command.event.type), [
      "TEXT_MESSAGE_END",
      "REASONING_MESSAGE_END",
      "TOOL_CALL_END",
    ]);
    assertEquals(
      missingCommands(result.commands).map((command) => command.producerOccurrence),
      [0, 1, 2].map((ordinal) => ({
        source: producerOccurrence.source,
        id: expectedExpansionId(ordinal),
      })),
    );
    assertEquals(missingCommands(result.commands).map((command) => command.requirement), [
      "native-ag-ui-projection-context",
      "native-ag-ui-projection-context",
      "native-ag-ui-projection-context",
    ]);
    assertEquals(canonicalCommands(result.commands).map((command) => command.event.type), [
      "com.veryfront.run.succeeded",
    ]);
    assertEquals(result.normalizationState, { pendingStreams: [] });
    assertEquals(tool.normalizationState, checkpoint);
    assertEquals(acceptAgUiEvent(input), result);
    assertThrows(
      () =>
        acceptAgUiEvent({
          ...input,
          producerOccurrence: { ...producerOccurrence, id: "wrong-occurrence" },
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );
    assertEquals(tool.normalizationState, checkpoint);
  });

  it("does not apply current text chunk context to a generated prior-message closure", () => {
    const initial = acceptAgUiEvent({
      event: { type: "TEXT_MESSAGE_CHUNK", messageId: "old-agui-message", delta: "old" },
      producerOccurrence: { source: producerOccurrence.source, id: "text-prior-occurrence" },
    });
    const currentOccurrence = {
      source: producerOccurrence.source,
      id: "text-current-occurrence",
      time: occurrence.time,
    } as const;
    const currentContext: AgUiNativeProfileContext = {
      family: "content",
      content: {
        family: "text",
        occurrence: currentOccurrence,
        message: {
          nativeMessageId: "native-message-current",
          nativeContentId: "native-content-current",
          agUiMessageId: "current-agui-message",
        },
      },
    };

    const result = acceptAgUiEvent({
      event: {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "current-agui-message",
        role: "assistant",
        delta: "current",
      },
      producerOccurrence: currentOccurrence,
      normalizationState: initial.normalizationState,
      nativeProfileContext: currentContext,
    });

    const expectedIds = [0, 1, 2].map((ordinal) =>
      expansionIdFor(currentOccurrence.source, currentOccurrence.id, ordinal)
    );
    assertEquals(
      expandedCommands(result.commands).map((command) => command.expansionId),
      expectedIds,
    );
    const missing = missingCommands(result.commands);
    assertEquals(missing.map((command) => command.producerOccurrence.id), [expectedIds[0]]);
    assertEquals(missing.map((command) => command.requirement), [
      "native-ag-ui-projection-context",
    ]);
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.producerOccurrence.id), expectedIds.slice(1));
    assertEquals(canonical.map((command) => command.event.id), expectedIds.slice(1));
    assertEquals(canonical.map((command) => command.event.type), [
      "com.veryfront.message.text.started",
      "com.veryfront.message.text.delta.emitted",
    ]);
  });

  it("does not apply current tool chunk context to a generated prior-tool closure", () => {
    const initial = acceptAgUiEvent({
      event: {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "old-agui-tool",
        toolCallName: "oldSearch",
        delta: "{}",
      },
      producerOccurrence: { source: producerOccurrence.source, id: "tool-prior-occurrence" },
    });
    const currentOccurrence = {
      source: producerOccurrence.source,
      id: "tool-current-occurrence",
      time: occurrence.time,
    } as const;
    const currentContext: AgUiNativeProfileContext = {
      family: "tool",
      tool: {
        kind: "call",
        occurrence: currentOccurrence,
        tool: {
          nativeToolCallId: "native-tool-current",
          nativeToolName: "native.currentSearch",
          agUiToolCallId: "current-agui-tool",
          agUiToolCallName: "currentSearch",
        },
      },
    };

    const result = acceptAgUiEvent({
      event: {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "current-agui-tool",
        toolCallName: "currentSearch",
        delta: '{"query":"current"}',
      },
      producerOccurrence: currentOccurrence,
      normalizationState: initial.normalizationState,
      nativeProfileContext: currentContext,
    });

    const expectedIds = [0, 1, 2].map((ordinal) =>
      expansionIdFor(currentOccurrence.source, currentOccurrence.id, ordinal)
    );
    assertEquals(
      expandedCommands(result.commands).map((command) => command.expansionId),
      expectedIds,
    );
    const missing = missingCommands(result.commands);
    assertEquals(missing.map((command) => command.producerOccurrence.id), [expectedIds[0]]);
    assertEquals(missing.map((command) => command.requirement), [
      "native-ag-ui-projection-context",
    ]);
    const canonical = canonicalCommands(result.commands);
    assertEquals(canonical.map((command) => command.producerOccurrence.id), expectedIds.slice(1));
    assertEquals(canonical.map((command) => command.event.id), expectedIds.slice(1));
    assertEquals(canonical.map((command) => command.event.type), [
      "com.veryfront.tool-call.started",
      "com.veryfront.tool-call.arguments.delta.emitted",
    ]);
  });

  it("fails closed when shorthand native profile context occurrence does not match accepted occurrence", () => {
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TEXT_MESSAGE_CHUNK", messageId: "agui-message-1", delta: "x" },
          producerOccurrence,
          nativeProfileContext: {
            ...textContentContext,
            content: {
              ...textContentContext.content,
              occurrence: { ...occurrence, id: "wrong-source-event" },
            },
          },
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );
  });

  it("preserves missing-fact compatibility when native profile context is absent", () => {
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
      producerOccurrence,
    });

    assertEquals(firstRequirement(result.commands), "native-run-suspension-outcome");
    assert(!result.commands.some((command) => command.kind === "canonical-native-event"));
  });

  it("emits canonical native run lifecycle records when explicit context is present", () => {
    const paused = canonicalRecordFor({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "interrupt-1", reason: "approval" }],
      },
    }, runContext);
    assertEquals(paused.type, "com.veryfront.run.paused");

    const cancelled = canonicalRecordFor({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "cancelled" },
    }, runContext);
    assertEquals(cancelled.type, "com.veryfront.run.cancelled");
  });

  it("emits canonical native synchronization records when explicit context is present", () => {
    const record = canonicalRecordFor({
      type: "STATE_DELTA",
      delta: [{ op: "add", path: "/user/name", value: "Ada" }],
    }, synchronizationContext);

    assertEquals(record.type, "com.veryfront.synchronization.state.delta.recorded");
  });

  it("emits opaque reasoning continuation records without visible text", () => {
    const record = canonicalRecordFor({
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "reasoning-1",
      encryptedValue: "ciphertext:AAE=",
    }, reasoningContext);

    assertEquals(record.type, "com.veryfront.reasoning.continuation.recorded");
    if (record.type !== "com.veryfront.reasoning.continuation.recorded") return;
    assertEquals(record.data.continuation.encryptedValue, "ciphertext:AAE=");
    assert(!("text" in record.data.continuation));
  });

  it("emits canonical invocation suspended records when explicit context is present", () => {
    const record = canonicalRecordFor({
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      outcome: { type: "suspended", interruptIds: ["interrupt-1"] },
    }, invocationContext);

    assertEquals(record.type, "com.veryfront.invocation.paused");
  });

  it("emits canonical native tool records for all ordinary variants with explicit mapping", () => {
    const cases = [
      [
        {
          type: "TOOL_CALL_START",
          toolCallId: "agui-tool-1",
          toolCallName: "search",
          parentMessageId: "agui-parent-message-1",
        },
        toolCallContext,
        "com.veryfront.tool-call.started",
      ],
      [
        { type: "TOOL_CALL_ARGS", toolCallId: "agui-tool-1", delta: '{"q"' },
        toolCallContext,
        "com.veryfront.tool-call.arguments.delta.emitted",
      ],
      [
        { type: "TOOL_CALL_END", toolCallId: "agui-tool-1" },
        toolCallContext,
        "com.veryfront.tool-call.arguments.ended",
      ],
      [
        {
          type: "TOOL_CALL_RESULT",
          messageId: "agui-result-message-1",
          toolCallId: "agui-tool-1",
          content: [{ type: "text", text: "done", metadata: { mime: "text/plain" } }],
          role: "tool",
        },
        toolResultContext,
        "com.veryfront.tool-call.result.recorded",
      ],
    ] as const;

    for (const [event, context, expectedType] of cases) {
      const record = canonicalRecordFor(event, context);
      assertEquals(record.type, expectedType);
      if (record.type === "com.veryfront.tool-call.result.recorded") {
        assertEquals(record.data.output, [{
          type: "text",
          text: "done",
          metadata: { mime: "text/plain" },
        }]);
      }
    }
  });

  it("emits canonical native content records for all ordinary variants with explicit mapping", () => {
    const cases = [
      [
        { type: "TEXT_MESSAGE_START", messageId: "agui-message-1", role: "assistant" },
        textContentContext,
        "com.veryfront.message.text.started",
      ],
      [
        { type: "TEXT_MESSAGE_CONTENT", messageId: "agui-message-1", delta: "hello" },
        textContentContext,
        "com.veryfront.message.text.delta.emitted",
      ],
      [
        { type: "TEXT_MESSAGE_END", messageId: "agui-message-1" },
        textContentContext,
        "com.veryfront.message.text.ended",
      ],
      [
        { type: "REASONING_MESSAGE_START", messageId: "agui-reasoning-1", role: "reasoning" },
        reasoningContentContext,
        "com.veryfront.message.reasoning.started",
      ],
      [
        { type: "REASONING_MESSAGE_CONTENT", messageId: "agui-reasoning-1", delta: "thinking" },
        reasoningContentContext,
        "com.veryfront.message.reasoning.delta.emitted",
      ],
      [
        { type: "REASONING_MESSAGE_END", messageId: "agui-reasoning-1" },
        reasoningContentContext,
        "com.veryfront.message.reasoning.ended",
      ],
      [
        { type: "STEP_STARTED", stepName: "Plan" },
        stepContentContext,
        "com.veryfront.step.started",
      ],
      [{ type: "STEP_FINISHED", stepName: "Plan" }, stepContentContext, "com.veryfront.step.ended"],
    ] as const;

    for (const [event, context, expectedType] of cases) {
      assertEquals(canonicalRecordFor(event, context).type, expectedType);
    }
  });

  it("normalizes empty upstream-valid content identities with exact producer occurrence", () => {
    const emptyTextContext: AgUiNativeProfileContext = {
      family: "content",
      content: {
        family: "text",
        occurrence,
        message: {
          nativeMessageId: "native-message-empty",
          nativeContentId: "native-content-empty",
          agUiMessageId: "",
        },
      },
    };
    assertEquals(
      canonicalRecordFor(
        { type: "TEXT_MESSAGE_CONTENT", messageId: "", delta: "empty" },
        emptyTextContext,
      )
        .type,
      "com.veryfront.message.text.delta.emitted",
    );

    const emptyStepContext: AgUiNativeProfileContext = {
      family: "content",
      content: {
        family: "step",
        occurrence,
        runid: "native-run-1",
        step: { nativeStepId: "native-step-empty", agUiStepName: "" },
      },
    };
    assertEquals(
      canonicalRecordFor({ type: "STEP_STARTED", stepName: "" }, emptyStepContext).type,
      "com.veryfront.step.started",
    );
  });

  it("fails closed for tool producer occurrence, mapping conflicts, and missing result context", () => {
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TOOL_CALL_ARGS", toolCallId: "agui-tool-1", delta: "x" },
          producerOccurrence,
          nativeProfileContext: {
            ...toolCallContext,
            tool: {
              ...toolCallContext.tool,
              occurrence: { ...occurrence, id: "other-tool-occurrence" },
            },
          },
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TOOL_CALL_ARGS", toolCallId: "wrong", delta: "x" },
          producerOccurrence,
          nativeProfileContext: toolCallContext,
        }),
      TypeError,
      "AG-UI toolCallId must match persisted mapping",
    );
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: {
            type: "TOOL_CALL_RESULT",
            messageId: "agui-result-message-1",
            toolCallId: "agui-tool-1",
            content: "done",
          },
          producerOccurrence,
          nativeProfileContext: toolCallContext,
        }),
      TypeError,
      "TOOL_CALL_RESULT requires persisted result message context",
    );
  });

  it("fails closed for content producer occurrence and mapping conflicts", () => {
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TEXT_MESSAGE_CONTENT", messageId: "agui-message-1", delta: "x" },
          producerOccurrence,
          nativeProfileContext: {
            ...textContentContext,
            content: {
              ...textContentContext.content,
              occurrence: { ...occurrence, source: "https://example.test/other" },
            },
          },
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "TEXT_MESSAGE_CONTENT", messageId: "wrong", delta: "x" },
          producerOccurrence,
          nativeProfileContext: textContentContext,
        }),
      TypeError,
      "AG-UI text messageId must match persisted mapping",
    );
  });

  it("emits inert custom signal records without granting authority", () => {
    const record = canonicalRecordFor({
      type: "CUSTOM",
      name: "vendor.admission.grant",
      value: { allow: true, resource: "tool:delete" },
    }, signalContext);

    assertEquals(record.type, "com.veryfront.signal.custom.recorded");
    if (record.type !== "com.veryfront.signal.custom.recorded") return;
    assertEquals(record.data.signal.name, "vendor.admission.grant");
    assert(!("authority" in record.data));
  });

  it("fails closed when native profile context source/id does not match the accepted occurrence", () => {
    assertThrows(
      () =>
        acceptAgUiEvent({
          event: { type: "CUSTOM", name: "vendor.signal", value: { ok: true } },
          producerOccurrence,
          nativeProfileContext: {
            ...signalContext,
            signal: {
              ...signalContext.signal,
              occurrence: { ...occurrence, id: "different-occurrence" },
            },
          },
        }),
      TypeError,
      "native profile context occurrence must match accepted producer occurrence",
    );
  });

  it("preserves native profile requirements instead of creating canonical records for conflicting authority", () => {
    const result = acceptAgUiEvent({
      event: {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "wrong-run",
        outcome: { type: "success" },
      },
      producerOccurrence,
      nativeProfileContext: runContext,
    });

    assert(!result.commands.some((command) => command.kind === "canonical-native-event"));
    assertEquals(firstRequirement(result.commands), "native-ag-ui-projection-context");
  });
});
