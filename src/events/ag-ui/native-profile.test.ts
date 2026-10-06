import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgUiNativeProfileContext } from "./native-profile.ts";
import {
  parseNativeProfileRecord,
  projectAgUiNativeProfileEvent,
  projectNativeProfileEvent,
} from "./native-profile.ts";

const occurrence = {
  source: "https://example.test/ag-ui/profile",
  id: "profile-occurrence-1",
  time: "2026-10-06T12:00:00.000Z",
} as const;

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

function canonical(event: unknown, context: AgUiNativeProfileContext) {
  const command = projectAgUiNativeProfileEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind !== "canonical-event") throw new Error(command.message);
  assertEquals(command.event.source, occurrence.source);
  assertEquals(command.event.id, occurrence.id);
  assertEquals(parseNativeProfileRecord(command.event), command.event);
  assertEquals(
    projectNativeProfileEvent({
      event: command.event,
      ...(context.family === "content" ? { contentContext: context.content } : {}),
      ...(context.family === "tool" ? { toolContext: context.tool } : {}),
    }),
    event,
  );
  return command;
}

describe("events/ag-ui/native-profile", () => {
  it("dispatches all completed run lifecycle variants including paused", () => {
    const cases = [
      {
        type: "RUN_STARTED",
        threadId: "thread-1",
        runId: "run-1",
      },
      {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-1",
        outcome: { type: "success" },
      },
      {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-1",
        outcome: { type: "cancelled" },
      },
      {
        type: "RUN_ERROR",
        message: "failed",
        code: "ERR_TEST",
      },
      {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-1",
        outcome: {
          type: "interrupt",
          interrupts: [{ id: "interrupt-1", reason: "approval" }],
        },
      },
    ] as const;
    const nativeTypes = cases.map((event) => canonical(event, runContext).event.type);
    assertEquals(nativeTypes, [
      "com.veryfront.run.started",
      "com.veryfront.run.succeeded",
      "com.veryfront.run.cancelled",
      "com.veryfront.run.failed",
      "com.veryfront.run.paused",
    ]);
  });

  it("dispatches all completed synchronization variants", () => {
    const cases = [
      {
        type: "STATE_SNAPSHOT",
        snapshot: { user: { name: "Ada" } },
      },
      {
        type: "STATE_DELTA",
        delta: [{ op: "add", path: "/user/name", value: "Ada" }],
      },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "user-1", role: "user", content: "hello" }],
      },
      {
        type: "ACTIVITY_SNAPSHOT",
        messageId: "activity-1",
        activityType: "status",
        content: { label: "working" },
      },
      {
        type: "ACTIVITY_DELTA",
        messageId: "activity-1",
        activityType: "status",
        patch: [{ op: "replace", path: "/label", value: "done" }],
      },
    ] as const;
    const nativeTypes = cases.map((event) => canonical(event, synchronizationContext).event.type);
    assertEquals(nativeTypes, [
      "com.veryfront.synchronization.state.snapshot.recorded",
      "com.veryfront.synchronization.state.delta.recorded",
      "com.veryfront.synchronization.transcript.snapshot.recorded",
      "com.veryfront.synchronization.activity.snapshot.recorded",
      "com.veryfront.synchronization.activity.delta.recorded",
    ]);
  });

  it("dispatches reasoning contexts and opaque encrypted continuation", () => {
    const start = canonical(
      { type: "REASONING_START", messageId: "reasoning-1" },
      reasoningContext,
    );
    const end = canonical({ type: "REASONING_END", messageId: "reasoning-1" }, reasoningContext);
    const continuation = canonical({
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "reasoning-1",
      encryptedValue: "ciphertext:AAE=",
    }, reasoningContext);

    assertEquals(start.event.type, "com.veryfront.reasoning.context.started");
    assertEquals(end.event.type, "com.veryfront.reasoning.context.ended");
    assertEquals(continuation.event.type, "com.veryfront.reasoning.continuation.recorded");
    if (continuation.event.type !== "com.veryfront.reasoning.continuation.recorded") return;
    assertEquals(continuation.event.data.continuation.encryptedValue, "ciphertext:AAE=");
    assert(!("text" in continuation.event.data.continuation));
  });

  it("dispatches invocation variants including suspended outcome", () => {
    const started = canonical({
      type: "SUBAGENT_STARTED",
      subagentRunId: "subagent-1",
      name: "researcher",
      parentToolCallId: "tool-1",
    }, invocationContext);
    const succeeded = canonical({
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      outcome: { type: "success" },
    }, invocationContext);
    const paused = canonical({
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      outcome: { type: "suspended", interruptIds: ["interrupt-1"] },
    }, invocationContext);
    const failed = canonical({
      type: "SUBAGENT_ERROR",
      subagentRunId: "subagent-1",
      message: "failed",
      code: "ERR_SUBAGENT",
    }, invocationContext);

    assertEquals(started.event.type, "com.veryfront.invocation.started");
    assertEquals(succeeded.event.type, "com.veryfront.invocation.succeeded");
    assertEquals(paused.event.type, "com.veryfront.invocation.paused");
    assertEquals(failed.event.type, "com.veryfront.invocation.failed");
  });

  it("dispatches ordinary tool variants with explicit persisted mapping context", () => {
    const types = [
      canonical({
        type: "TOOL_CALL_START",
        toolCallId: "agui-tool-1",
        toolCallName: "search",
        parentMessageId: "agui-parent-message-1",
      }, toolCallContext).event.type,
      canonical(
        { type: "TOOL_CALL_ARGS", toolCallId: "agui-tool-1", delta: '{"q"' },
        toolCallContext,
      )
        .event.type,
      canonical({ type: "TOOL_CALL_END", toolCallId: "agui-tool-1" }, toolCallContext).event.type,
      canonical({
        type: "TOOL_CALL_RESULT",
        messageId: "agui-result-message-1",
        toolCallId: "agui-tool-1",
        content: [{ type: "text", text: "done", metadata: { mime: "text/plain" } }],
        role: "tool",
      }, toolResultContext).event.type,
    ];

    assertEquals(types, [
      "com.veryfront.tool-call.started",
      "com.veryfront.tool-call.arguments.delta.emitted",
      "com.veryfront.tool-call.arguments.ended",
      "com.veryfront.tool-call.result.recorded",
    ]);
  });

  it("requires exact tool mapping for native tool reverse projection", () => {
    const command = canonical({
      type: "TOOL_CALL_RESULT",
      messageId: "agui-result-message-1",
      toolCallId: "agui-tool-1",
      content: [{ type: "text", text: "done" }],
      role: "tool",
    }, toolResultContext);

    assertThrows(
      () => projectNativeProfileEvent({ event: command.event }),
      TypeError,
      "native tool profile projection requires explicit tool context",
    );
    assertThrows(
      () =>
        projectNativeProfileEvent({
          event: command.event,
          toolContext: {
            kind: "result",
            occurrence,
            tool: {
              ...toolResultContext.tool.tool,
              agUiToolCallId: "other-agui-tool",
            },
            resultMessage: toolResultMessage,
          },
        }),
      TypeError,
      "tool context AG-UI toolCallId must match saved protocol identity",
    );
  });

  it("dispatches ordinary content variants with explicit persisted mapping context", () => {
    const textTypes = [
      canonical({
        type: "TEXT_MESSAGE_START",
        messageId: "agui-message-1",
        role: "assistant",
        name: "Ada",
      }, textContentContext).event.type,
      canonical({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "agui-message-1",
        delta: "hello",
      }, textContentContext).event.type,
      canonical({ type: "TEXT_MESSAGE_END", messageId: "agui-message-1" }, textContentContext).event
        .type,
    ];
    assertEquals(textTypes, [
      "com.veryfront.message.text.started",
      "com.veryfront.message.text.delta.emitted",
      "com.veryfront.message.text.ended",
    ]);

    const reasoningTypes = [
      canonical({
        type: "REASONING_MESSAGE_START",
        messageId: "agui-reasoning-1",
        role: "reasoning",
      }, reasoningContentContext).event.type,
      canonical({
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "agui-reasoning-1",
        delta: "thinking",
      }, reasoningContentContext).event.type,
      canonical({
        type: "REASONING_MESSAGE_END",
        messageId: "agui-reasoning-1",
      }, reasoningContentContext).event.type,
    ];
    assertEquals(reasoningTypes, [
      "com.veryfront.message.reasoning.started",
      "com.veryfront.message.reasoning.delta.emitted",
      "com.veryfront.message.reasoning.ended",
    ]);

    const stepTypes = [
      canonical({ type: "STEP_STARTED", stepName: "Plan" }, stepContentContext).event.type,
      canonical({ type: "STEP_FINISHED", stepName: "Plan" }, stepContentContext).event.type,
    ];
    assertEquals(stepTypes, ["com.veryfront.step.started", "com.veryfront.step.ended"]);
  });

  it("requires exact content mapping for native content reverse projection", () => {
    const command = canonical({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "agui-message-1",
      delta: "hello",
    }, textContentContext);

    assertThrows(
      () => projectNativeProfileEvent({ event: command.event }),
      TypeError,
      "native content profile projection requires explicit content context",
    );
    assertThrows(
      () =>
        projectNativeProfileEvent({
          event: command.event,
          contentContext: {
            family: "text",
            occurrence,
            message: {
              nativeMessageId: "other-native-message",
              nativeContentId: "native-content-text-1",
              agUiMessageId: "agui-message-1",
            },
          },
        }),
      TypeError,
      "native text message/content IDs must match persisted mapping",
    );
  });

  it("dispatches empty upstream-valid content IDs through explicit mapping", () => {
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
    const text = canonical(
      { type: "TEXT_MESSAGE_CONTENT", messageId: "", delta: "empty id" },
      emptyTextContext,
    );
    assertEquals(text.event.type, "com.veryfront.message.text.delta.emitted");

    const emptyStepContext: AgUiNativeProfileContext = {
      family: "content",
      content: {
        family: "step",
        occurrence,
        runid: "native-run-1",
        step: { nativeStepId: "native-step-empty", agUiStepName: "" },
      },
    };
    const step = canonical({ type: "STEP_STARTED", stepName: "" }, emptyStepContext);
    assertEquals(step.event.type, "com.veryfront.step.started");
  });

  it("dispatches RAW and inert CUSTOM signal variants", () => {
    const raw = canonical({
      type: "RAW",
      event: { provider: "opaque", payload: [1, true] },
      source: "provider.raw",
    }, signalContext);
    const custom = canonical({
      type: "CUSTOM",
      name: "vendor.admission.grant",
      value: { allow: true, resource: "tool:delete" },
    }, signalContext);

    assertEquals(raw.event.type, "com.veryfront.signal.raw.recorded");
    assertEquals(custom.event.type, "com.veryfront.signal.custom.recorded");
    if (custom.event.type !== "com.veryfront.signal.custom.recorded") return;
    assertEquals(custom.event.data.signal.name, "vendor.admission.grant");
    assert(!("authority" in custom.event.data));
  });

  it("rejects context family mismatches and envelope/protocol conflicts", () => {
    assertThrows(
      () =>
        projectAgUiNativeProfileEvent({
          event: { type: "CUSTOM", name: "vendor.signal", value: { ok: true } },
          context: runContext,
        }),
      TypeError,
      "AG-UI signal event cannot be projected with run context",
    );

    const command = canonical({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "success" },
    }, runContext);
    if (command.event.type !== "com.veryfront.run.succeeded") {
      throw new Error("test fixture must project run.succeeded");
    }
    const runEvent = command.event;
    const runData = runEvent.data;
    if (!("extensions" in runData)) throw new Error("test fixture must include extensions");
    assertThrows(
      () =>
        parseNativeProfileRecord({
          ...runEvent,
          data: {
            ...runData,
            extensions: {
              ...runData.extensions,
              "urn:veryfront:ag-ui:protocol:run-lifecycle:1": {
                name: "ag-ui",
                version: "1.0",
                eventType: "RUN_FINISHED",
                run: { threadId: "thread-1", runId: "run-1" },
                outcome: {
                  type: "interrupt",
                  interrupts: [{ id: "interrupt-1", reason: "approval" }],
                },
              },
            },
          },
        }),
      TypeError,
      "run.succeeded cannot carry cancelled or interrupt AG-UI outcome metadata",
    );

    const failed = canonical({
      type: "RUN_ERROR",
      message: "protocol failed",
      code: "ERR_PROTOCOL",
    }, runContext);
    if (failed.event.type !== "com.veryfront.run.failed") {
      throw new Error("test fixture must project run.failed");
    }
    assertThrows(
      () =>
        projectNativeProfileEvent({
          event: {
            ...failed.event,
            data: {
              ...failed.event.data,
              error: { message: "payload failed", code: "ERR_PAYLOAD" },
            },
          },
        }),
      TypeError,
      "run.failed error payload does not match AG-UI RUN_ERROR protocol metadata",
    );
  });

  it("does not claim ordinary text/tool/step profile ingress without persisted mapping context", () => {
    assertThrows(
      () => parseNativeProfileRecord({ type: "com.veryfront.message.created" }),
      TypeError,
      "completed AG-UI native profile record type",
    );
  });
});
