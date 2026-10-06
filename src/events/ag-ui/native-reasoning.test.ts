import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgUiEventOf } from "#veryfront/events/ag-ui/types.ts";
import {
  AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE,
  createGeneratedReasoningFrame,
  parseNativeReasoningEvent,
  parseNativeReasoningRecord,
  projectAgUiReasoningEvent,
  projectNativeReasoningEvent,
} from "#veryfront/events/ag-ui/native-reasoning.ts";
import type { AgUiReasoningProjectionContext } from "#veryfront/events/ag-ui/native-reasoning.ts";

const context: AgUiReasoningProjectionContext = {
  occurrence: {
    source: "https://example.test/ag-ui/reasoning",
    id: "reasoning-occurrence-1",
    time: "2026-10-06T12:00:00.000Z",
  },
  runid: "native-run-1",
  runkind: "agent",
  conversationid: "conversation-1",
} as const;

function canonical(
  event: AgUiEventOf<"REASONING_START" | "REASONING_END" | "REASONING_ENCRYPTED_VALUE">,
) {
  const command = projectAgUiReasoningEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind !== "canonical-event") throw new Error(command.message);
  return command;
}

describe("events/ag-ui/native-reasoning", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    const event: AgUiEventOf<"REASONING_START"> = {
      type: "REASONING_START",
      messageId: "reasoning-message-1",
      subagentRunId: "",
    };
    const command = canonical(event);
    assertEquals(projectNativeReasoningEvent({ event: command.event }), event);
  });

  it("projects REASONING_START to internal context.started with metadata and exact occurrence identity", () => {
    const event: AgUiEventOf<"REASONING_START"> & {
      readonly extensionReasoning: { readonly opaque: true };
    } = {
      type: "REASONING_START",
      messageId: "reasoning-message-1",
      timestamp: 100,
      rawEvent: { provider: "upstream" },
      metadata: { trace: "start" },
      subagentRunId: "subagent-1",
      extensionReasoning: { opaque: true },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.reasoning.context.started");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE["com.veryfront.reasoning.context.started"],
    );
    assertEquals(command.event.source, context.occurrence.source);
    assertEquals(command.event.id, context.occurrence.id);
    assertEquals(command.event.runid, context.runid);
    if (command.event.type !== "com.veryfront.reasoning.context.started") return;
    assertEquals(command.event.data.context, { messageId: "reasoning-message-1" });
    assertEquals(command.event.data.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "REASONING_START",
      timestamp: 100,
      rawEvent: { provider: "upstream" },
      metadata: { trace: "start" },
      extensions: { extensionReasoning: { opaque: true } },
      attribution: { invocation: { subagentRunId: "subagent-1" } },
    });
    assertEquals(parseNativeReasoningRecord(command.event), command.event);
    assertEquals(parseNativeReasoningEvent(command.event), command.event);
    assertEquals(projectNativeReasoningEvent({ event: command.event }), event);
  });

  it("round trips REASONING_END through internal context.ended", () => {
    const event: AgUiEventOf<"REASONING_END"> = {
      type: "REASONING_END",
      messageId: "reasoning-message-1",
      metadata: { trace: "end" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.reasoning.context.ended");
    if (command.event.type !== "com.veryfront.reasoning.context.ended") return;
    assertEquals(command.event.data.context, { messageId: "reasoning-message-1" });
    assertEquals(projectNativeReasoningEvent({ event: command.event }), event);
  });

  it("preserves encrypted continuation byte-exactly without visible text projection", () => {
    const event: AgUiEventOf<"REASONING_ENCRYPTED_VALUE"> = {
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "reasoning-message-1",
      encryptedValue: "ciphertext:AAECAwQ=",
      metadata: { keyRef: "private-key-1" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.reasoning.continuation.recorded");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE["com.veryfront.reasoning.continuation.recorded"],
    );
    if (command.event.type !== "com.veryfront.reasoning.continuation.recorded") return;
    assertEquals(command.event.data.continuation, {
      subtype: "message",
      entityId: "reasoning-message-1",
      encryptedValue: "ciphertext:AAECAwQ=",
    });
    assert(!("text" in command.event.data.continuation));
    assert(!("delta" in command.event.data.continuation));
    assertEquals(projectNativeReasoningEvent({ event: command.event }), event);
  });

  it("rejects malformed encrypted continuation payloads and visible-text leakage fields", () => {
    const command = canonical({
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "tool-call",
      entityId: "tool-call-1",
      encryptedValue: "opaque-bytes",
    });
    if (command.event.type !== "com.veryfront.reasoning.continuation.recorded") return;
    const continuationData = command.event.data;
    if (!("continuation" in continuationData)) throw new Error("test fixture must be continuation");

    assertThrows(
      () =>
        parseNativeReasoningRecord({
          ...command.event,
          data: {
            ...command.event.data,
            continuation: { subtype: "tool-call", entityId: "tool-call-1" },
          },
        }),
      TypeError,
      "Invalid native reasoning event",
    );

    assertThrows(
      () =>
        parseNativeReasoningRecord({
          ...command.event,
          data: {
            ...command.event.data,
            continuation: { ...continuationData.continuation, text: "do not reveal" },
          },
        }),
      TypeError,
      "Invalid native reasoning event",
    );
  });

  it("rejects reserved AG-UI fields inside protocol extensions on reverse projection", () => {
    const command = canonical({
      type: "REASONING_START",
      messageId: "reasoning-message-1",
    });
    if (command.event.type !== "com.veryfront.reasoning.context.started") return;

    assertThrows(
      () =>
        projectNativeReasoningEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              protocol: {
                agui: {
                  ...command.event.data.protocol.agui,
                  extensions: { messageId: "forged-message" },
                },
              },
            },
          },
        }),
      TypeError,
      "protocol.agui.extensions must not contain reserved AG-UI field messageId",
    );
  });

  it("keeps generated reasoning frames without durable identity", () => {
    const frame = createGeneratedReasoningFrame({
      type: "REASONING_ENCRYPTED_VALUE",
      subtype: "message",
      entityId: "reasoning-message-1",
      encryptedValue: "opaque-bytes",
    });
    assertEquals(frame.kind, "generated-read-frame");
    assert(!("id" in frame));
    assert(!("source" in frame));
    assertEquals(frame.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "REASONING_ENCRYPTED_VALUE",
    });
  });
});
