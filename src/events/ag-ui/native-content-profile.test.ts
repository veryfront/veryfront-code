import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEvent } from "#veryfront/events/parser.ts";
import {
  AG_UI_CONTENT_PROTOCOL_EXTENSION_URI,
  type AgUiContentProfileContext,
  parseNativeContentRecord,
  projectAgUiContentEvent,
  projectNativeContentEvent,
} from "#veryfront/events/ag-ui/native-content-profile.ts";

const occurrence = {
  source: "https://example.test/ag-ui/content",
  id: "content-occurrence-1",
  time: "2026-10-06T12:00:00.000Z",
} as const;

const textContext: AgUiContentProfileContext = {
  family: "text",
  occurrence,
  message: {
    nativeMessageId: "native-message-1",
    nativeContentId: "native-content-text-1",
    agUiMessageId: "agui-message-1",
  },
} as const;

const reasoningContext: AgUiContentProfileContext = {
  family: "reasoning",
  occurrence,
  message: {
    nativeMessageId: "native-message-1",
    nativeContentId: "native-content-reasoning-1",
    agUiMessageId: "agui-reasoning-1",
  },
} as const;

const stepContext: AgUiContentProfileContext = {
  family: "step",
  occurrence,
  runid: "native-run-1",
  step: {
    nativeStepId: "native-step-1",
    agUiStepName: "Plan",
  },
} as const;

function canonical(event: unknown, context: AgUiContentProfileContext) {
  const command = projectAgUiContentEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind === "missing-fact-requirement") throw new Error(command.message);
  if (command.kind !== "canonical-event") throw new Error("expected canonical event");
  assertEquals(command.event.source, occurrence.source);
  assertEquals(command.event.id, occurrence.id);
  assertEquals(parseNativeContentRecord(command.event), command.event);
  return command.event;
}

function roundtrip(event: unknown, context: AgUiContentProfileContext) {
  const native = canonical(event, context);
  const projected = projectNativeContentEvent({ event: native, context });
  assertEquals(projected.kind, "ag-ui-event");
  if (projected.kind === "missing-fact-requirement") throw new Error(projected.message);
  if (projected.kind !== "ag-ui-event") throw new Error("expected AG-UI event");
  assertEquals(projected.producerOccurrence, { source: occurrence.source, id: occurrence.id });
  assertEquals(projected.event, event);
  return native;
}

describe("events/ag-ui/native-content-profile", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    roundtrip({
      type: "TEXT_MESSAGE_START",
      messageId: "agui-message-1",
      role: "assistant",
      subagentRunId: "",
    }, textContext);
  });

  it("rejects native projection when wrapping vendor metadata exceeds its snapshot budget", () => {
    let vendorTrace: unknown = "leaf";
    for (let depth = 0; depth < 127; depth += 1) vendorTrace = { nested: vendorTrace };
    const fixtures = [
      {
        event: { type: "TEXT_MESSAGE_CONTENT", messageId: "agui-message-1", delta: "text" },
        context: textContext,
      },
      {
        event: { type: "TEXT_MESSAGE_START", messageId: "agui-message-1", role: "assistant" },
        context: textContext,
      },
      { event: { type: "TEXT_MESSAGE_END", messageId: "agui-message-1" }, context: textContext },
      {
        event: {
          type: "REASONING_MESSAGE_START",
          messageId: "agui-reasoning-1",
          role: "reasoning",
        },
        context: reasoningContext,
      },
      {
        event: {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: "agui-reasoning-1",
          delta: "thought",
        },
        context: reasoningContext,
      },
      {
        event: { type: "REASONING_MESSAGE_END", messageId: "agui-reasoning-1" },
        context: reasoningContext,
      },
      { event: { type: "STEP_STARTED", stepName: "Plan" }, context: stepContext },
      { event: { type: "STEP_FINISHED", stepName: "Plan" }, context: stepContext },
    ];
    for (const { event, context } of fixtures) {
      const projected = projectAgUiContentEvent({ event: { ...event, vendorTrace }, context });
      assertEquals(projected.kind, "missing-fact-requirement", event.type);
    }
  });

  it("roundtrips text start/content/end with exact persisted message mapping", () => {
    const start = roundtrip({
      type: "TEXT_MESSAGE_START",
      messageId: "agui-message-1",
      role: "assistant",
      name: "Ada",
      timestamp: 123,
      metadata: { visible: true },
      vendorTrace: { opaque: true },
    }, textContext);
    assertEquals(start.type, "com.veryfront.message.text.started");
    if (start.type !== "com.veryfront.message.text.started") return;
    assertEquals(start.data.messageId, "native-message-1");
    assertEquals(start.data.contentId, "native-content-text-1");
    assertEquals(start.data.role, "assistant");
    assertEquals(
      start.data.extensions?.[AG_UI_CONTENT_PROTOCOL_EXTENSION_URI],
      {
        name: "ag-ui",
        version: "1.0",
        eventType: "TEXT_MESSAGE_START",
        timestamp: 123,
        metadata: { visible: true },
        extensions: { vendorTrace: { opaque: true } },
        identity: { messageId: "agui-message-1" },
        message: { name: "Ada" },
      },
    );

    assertEquals(
      roundtrip({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "agui-message-1",
        delta: "hello",
      }, textContext).type,
      "com.veryfront.message.text.delta.emitted",
    );
    assertEquals(
      roundtrip({ type: "TEXT_MESSAGE_END", messageId: "agui-message-1" }, textContext).type,
      "com.veryfront.message.text.ended",
    );
  });

  it("roundtrips reasoning message events without inventing visible text", () => {
    const start = roundtrip({
      type: "REASONING_MESSAGE_START",
      messageId: "agui-reasoning-1",
      role: "reasoning",
      metadata: { mode: "private" },
    }, reasoningContext);
    assertEquals(start.type, "com.veryfront.message.reasoning.started");
    assert(!("role" in start.data));

    assertEquals(
      roundtrip({
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "agui-reasoning-1",
        delta: "thinking",
      }, reasoningContext).type,
      "com.veryfront.message.reasoning.delta.emitted",
    );
    assertEquals(
      roundtrip({
        type: "REASONING_MESSAGE_END",
        messageId: "agui-reasoning-1",
      }, reasoningContext).type,
      "com.veryfront.message.reasoning.ended",
    );
  });

  it("roundtrips step start and finish as ordinary step boundary facts", () => {
    const started = roundtrip({ type: "STEP_STARTED", stepName: "Plan" }, stepContext);
    assertEquals(started.type, "com.veryfront.step.started");
    if (started.type !== "com.veryfront.step.started") return;
    assertEquals(started.runid, "native-run-1");
    assertEquals(started.data.stepId, "native-step-1");
    assertEquals(started.data.name, "Plan");

    const finished = roundtrip({ type: "STEP_FINISHED", stepName: "Plan" }, stepContext);
    assertEquals(finished.type, "com.veryfront.step.ended");
  });

  it("preserves upstream-valid empty AG-UI message IDs and step names with nonempty native IDs", () => {
    const emptyTextContext: AgUiContentProfileContext = {
      ...textContext,
      message: {
        nativeMessageId: "native-message-empty-agui-id",
        nativeContentId: "native-content-empty-agui-id",
        agUiMessageId: "",
      },
    };
    assertEquals(
      roundtrip(
        { type: "TEXT_MESSAGE_CONTENT", messageId: "", delta: "empty id" },
        emptyTextContext,
      )
        .type,
      "com.veryfront.message.text.delta.emitted",
    );

    const emptyStepContext: AgUiContentProfileContext = {
      ...stepContext,
      step: { nativeStepId: "native-step-empty-agui-name", agUiStepName: "" },
    };
    const step = roundtrip({ type: "STEP_STARTED", stepName: "" }, emptyStepContext);
    assertEquals(step.type, "com.veryfront.step.started");
    if (step.type !== "com.veryfront.step.started") return;
    assertEquals(step.data.stepId, "native-step-empty-agui-name");
    assert(!("name" in step.data));
  });

  it("rejects AG-UI events whose IDs do not match the supplied mapping", () => {
    assertThrows(
      () =>
        projectAgUiContentEvent({
          event: { type: "TEXT_MESSAGE_CONTENT", messageId: "other-message", delta: "x" },
          context: textContext,
        }),
      TypeError,
      "AG-UI text messageId must match persisted mapping",
    );
    assertThrows(
      () =>
        projectAgUiContentEvent({
          event: { type: "STEP_FINISHED", stepName: "Other" },
          context: stepContext,
        }),
      TypeError,
      "AG-UI stepName must match persisted mapping",
    );
  });

  it("rejects native records whose IDs conflict with the supplied mapping", () => {
    const native = canonical({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "agui-message-1",
      delta: "hello",
    }, textContext);

    assertThrows(
      () =>
        projectNativeContentEvent({
          event: parseEvent({
            ...native,
            data: { ...native.data, messageId: "forged-message" },
          }),
          context: textContext,
        }),
      TypeError,
      "native text message/content IDs must match persisted mapping",
    );
  });

  it("rejects reserved AG-UI extension overrides on reverse projection", () => {
    const native = canonical({
      type: "TEXT_MESSAGE_START",
      messageId: "agui-message-1",
      role: "assistant",
      vendorTrace: true,
    }, textContext);

    assertThrows(
      () =>
        projectNativeContentEvent({
          event: parseEvent({
            ...native,
            data: {
              ...native.data,
              extensions: {
                ...native.data.extensions,
                [AG_UI_CONTENT_PROTOCOL_EXTENSION_URI]: {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "TEXT_MESSAGE_START",
                  identity: { messageId: "agui-message-1" },
                  extensions: { messageId: "forged" },
                },
              },
            },
          }),
          context: textContext,
        }),
      TypeError,
      "protocol.agui.extensions must not contain reserved AG-UI field messageId",
    );
  });

  it("rejects reverse projection when protocol metadata conflicts with the canonical native event", () => {
    const text = canonical({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "agui-message-1",
      delta: "hello",
    }, textContext);
    assertThrows(
      () =>
        projectNativeContentEvent({
          event: parseEvent({
            ...text,
            data: {
              ...text.data,
              extensions: {
                ...text.data.extensions,
                [AG_UI_CONTENT_PROTOCOL_EXTENSION_URI]: {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "TEXT_MESSAGE_END",
                },
              },
            },
          }),
          context: textContext,
        }),
      TypeError,
      "protocol.agui.eventType must be TEXT_MESSAGE_CONTENT",
    );

    const step = canonical({ type: "STEP_FINISHED", stepName: "Plan" }, stepContext);
    assertThrows(
      () =>
        projectNativeContentEvent({
          event: parseEvent({
            ...step,
            data: { ...step.data, name: "Different" },
          }),
          context: stepContext,
        }),
      TypeError,
      "native step name must match persisted mapping",
    );
  });

  it("rejects reverse remapping of saved AG-UI counterpart identity", () => {
    const text = canonical({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "agui-message-1",
      delta: "hello",
    }, textContext);
    assertThrows(
      () =>
        projectNativeContentEvent({
          event: text,
          context: {
            family: "text",
            occurrence,
            message: {
              nativeMessageId: "native-message-1",
              nativeContentId: "native-content-text-1",
              agUiMessageId: "other-agui-message",
            },
          },
        }),
      TypeError,
      "content context AG-UI messageId must match saved protocol identity",
    );

    const emptyStepContext: AgUiContentProfileContext = {
      family: "step",
      occurrence,
      runid: "native-run-1",
      step: { nativeStepId: "native-step-empty-agui-name", agUiStepName: "" },
    };
    const step = canonical({ type: "STEP_STARTED", stepName: "" }, emptyStepContext);
    assertThrows(
      () =>
        projectNativeContentEvent({
          event: step,
          context: {
            family: "step",
            occurrence,
            runid: "native-run-1",
            step: { nativeStepId: "native-step-empty-agui-name", agUiStepName: "Other" },
          },
        }),
      TypeError,
      "content context AG-UI stepName must match saved protocol identity",
    );
  });

  it("returns explicit missing requirements for redacted native content", () => {
    const native = parseEvent({
      specversion: "1.0",
      id: occurrence.id,
      source: occurrence.source,
      type: "com.veryfront.message.reasoning.delta.emitted",
      datacontenttype: "application/json",
      dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/MessageReasoningDeltaEmitted",
      data: {
        messageId: "native-message-1",
        contentId: "native-content-reasoning-1",
        contentRedacted: true,
      },
    });

    const command = projectNativeContentEvent({ event: native, context: reasoningContext });
    assertEquals(command.kind, "missing-fact-requirement");
    assertEquals(
      command.kind === "missing-fact-requirement" ? command.reason : undefined,
      "redacted-content",
    );
  });
});
