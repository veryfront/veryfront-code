import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEvent } from "#veryfront/events/parser.ts";
import {
  AG_UI_TOOL_PROTOCOL_EXTENSION_URI,
  type AgUiToolProfileContext,
  parseNativeToolRecord,
  projectAgUiToolEvent,
  projectNativeToolEvent,
} from "#veryfront/events/ag-ui/native-tool-profile.ts";

const occurrence = {
  source: "https://example.test/ag-ui/tool",
  id: "tool-occurrence-1",
  time: "2026-10-06T12:00:00.000Z",
} as const;

const callContext: AgUiToolProfileContext = {
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
} as const;

const resultContext: AgUiToolProfileContext = {
  kind: "result",
  occurrence,
  tool: callContext.tool,
  resultMessage: {
    nativeMessageId: "native-result-message-1",
    agUiMessageId: "agui-result-message-1",
  },
} as const;

function canonical(event: unknown, context: AgUiToolProfileContext) {
  const command = projectAgUiToolEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind === "missing-fact-requirement") throw new Error(command.message);
  if (command.kind !== "canonical-event") throw new Error("expected canonical event");
  assertEquals(command.event.source, occurrence.source);
  assertEquals(command.event.id, occurrence.id);
  assertEquals(parseNativeToolRecord(command.event), command.event);
  return command.event;
}

function roundtrip(event: unknown, context: AgUiToolProfileContext) {
  const native = canonical(event, context);
  const projected = projectNativeToolEvent({ event: native, context });
  assertEquals(projected.kind, "ag-ui-event");
  if (projected.kind === "missing-fact-requirement") throw new Error(projected.message);
  if (projected.kind !== "ag-ui-event") throw new Error("expected AG-UI event");
  assertEquals(projected.producerOccurrence, { source: occurrence.source, id: occurrence.id });
  assertEquals(projected.event, event);
  return native;
}

describe("events/ag-ui/native-tool-profile", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    roundtrip({
      type: "TOOL_CALL_START",
      toolCallId: "agui-tool-1",
      toolCallName: "search",
      subagentRunId: "",
    }, callContext);
  });

  it("roundtrips tool start, args, end, and result with exact persisted mapping", () => {
    const start = roundtrip({
      type: "TOOL_CALL_START",
      toolCallId: "agui-tool-1",
      toolCallName: "search",
      parentMessageId: "agui-parent-message-1",
      timestamp: 123,
      metadata: { visible: true },
      vendorTrace: { opaque: true },
    }, callContext);
    assertEquals(start.type, "com.veryfront.tool-call.started");
    if (start.type !== "com.veryfront.tool-call.started") return;
    assertEquals(start.data.toolCallId, "native-tool-1");
    assertEquals(start.data.toolName, "native.search");
    assertEquals(start.data.messageId, "native-parent-message-1");
    assertEquals(start.data.extensions?.[AG_UI_TOOL_PROTOCOL_EXTENSION_URI], {
      name: "ag-ui",
      version: "1.0",
      eventType: "TOOL_CALL_START",
      timestamp: 123,
      metadata: { visible: true },
      extensions: { vendorTrace: { opaque: true } },
      identity: {
        toolCallId: "agui-tool-1",
        toolCallName: "search",
        parentMessageId: "agui-parent-message-1",
      },
    });

    assertEquals(
      roundtrip({ type: "TOOL_CALL_ARGS", toolCallId: "agui-tool-1", delta: '{"q"' }, callContext)
        .type,
      "com.veryfront.tool-call.arguments.delta.emitted",
    );
    assertEquals(
      roundtrip({ type: "TOOL_CALL_END", toolCallId: "agui-tool-1" }, callContext).type,
      "com.veryfront.tool-call.arguments.ended",
    );
    assertEquals(
      roundtrip({
        type: "TOOL_CALL_RESULT",
        messageId: "agui-result-message-1",
        toolCallId: "agui-tool-1",
        content: "done",
        role: "tool",
      }, resultContext).type,
      "com.veryfront.tool-call.result.recorded",
    );
  });

  it("preserves multimodal tool result content as JSON output without authority", () => {
    const native = roundtrip({
      type: "TOOL_CALL_RESULT",
      messageId: "agui-result-message-1",
      toolCallId: "agui-tool-1",
      content: [{ type: "text", text: "hello", metadata: { lang: "en" } }],
      role: "tool",
    }, resultContext);

    assertEquals(native.type, "com.veryfront.tool-call.result.recorded");
    if (native.type !== "com.veryfront.tool-call.result.recorded") return;
    assertEquals(native.data.output, [{ type: "text", text: "hello", metadata: { lang: "en" } }]);
    assert(!("submitted" in native.data));
    assert(!("authority" in native.data));
  });

  it("preserves upstream-valid empty AG-UI tool IDs and names with trusted nonempty native mapping", () => {
    const emptyContext: AgUiToolProfileContext = {
      kind: "call",
      occurrence,
      tool: {
        nativeToolCallId: "native-tool-empty-agui",
        nativeToolName: "native.empty",
        agUiToolCallId: "",
        agUiToolCallName: "",
      },
    };
    const native = roundtrip(
      { type: "TOOL_CALL_START", toolCallId: "", toolCallName: "" },
      emptyContext,
    );
    assertEquals(native.type, "com.veryfront.tool-call.started");
    if (native.type !== "com.veryfront.tool-call.started") return;
    assertEquals(native.data.toolCallId, "native-tool-empty-agui");
    assertEquals(native.data.toolName, "native.empty");
  });

  it("rejects mismatched AG-UI IDs, names, parents, and missing result context", () => {
    assertThrows(
      () =>
        projectAgUiToolEvent({
          event: { type: "TOOL_CALL_ARGS", toolCallId: "wrong", delta: "x" },
          context: callContext,
        }),
      TypeError,
      "AG-UI toolCallId must match persisted mapping",
    );
    assertThrows(
      () =>
        projectAgUiToolEvent({
          event: { type: "TOOL_CALL_START", toolCallId: "agui-tool-1", toolCallName: "other" },
          context: callContext,
        }),
      TypeError,
      "AG-UI toolCallName must match persisted mapping",
    );
    assertThrows(
      () =>
        projectAgUiToolEvent({
          event: {
            type: "TOOL_CALL_START",
            toolCallId: "agui-tool-1",
            toolCallName: "search",
            parentMessageId: "other-parent",
          },
          context: callContext,
        }),
      TypeError,
      "AG-UI parentMessageId must match persisted mapping",
    );
    assertThrows(
      () =>
        projectAgUiToolEvent({
          event: {
            type: "TOOL_CALL_RESULT",
            messageId: "agui-result-message-1",
            toolCallId: "agui-tool-1",
            content: "done",
          },
          context: callContext,
        }),
      TypeError,
      "TOOL_CALL_RESULT requires persisted result message context",
    );
  });

  it("rejects native source/id, canonical payload, protocol identity, and reserved override conflicts", () => {
    const native = canonical({
      type: "TOOL_CALL_START",
      toolCallId: "agui-tool-1",
      toolCallName: "search",
    }, callContext);
    assertThrows(
      () => projectNativeToolEvent({ event: { ...native, id: "other" }, context: callContext }),
      TypeError,
      "native tool record source/id must match persisted mapping occurrence",
    );
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: parseEvent({ ...native, data: { ...native.data, toolCallId: "forged" } }),
          context: callContext,
        }),
      TypeError,
      "native toolCallId must match persisted mapping",
    );
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: native,
          context: { ...callContext, tool: { ...callContext.tool, agUiToolCallId: "other" } },
        }),
      TypeError,
      "tool context AG-UI toolCallId must match saved protocol identity",
    );
    const parentedNative = canonical({
      type: "TOOL_CALL_START",
      toolCallId: "agui-tool-1",
      toolCallName: "search",
      parentMessageId: "agui-parent-message-1",
    }, callContext);
    if (parentedNative.type !== "com.veryfront.tool-call.started") {
      throw new Error("expected native tool start");
    }
    const { messageId: _droppedParentMessageId, ...nativeStartWithoutParent } = parentedNative.data;
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: parseEvent({ ...parentedNative, data: nativeStartWithoutParent }),
          context: callContext,
        }),
      TypeError,
      "native parent messageId must match saved protocol identity presence",
    );
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: parseEvent({
            ...parentedNative,
            data: { ...parentedNative.data, messageId: "other-native-parent" },
          }),
          context: callContext,
        }),
      TypeError,
      "native parent messageId must match persisted mapping",
    );
    const unparentedNative = canonical({
      type: "TOOL_CALL_START",
      toolCallId: "agui-tool-1",
      toolCallName: "search",
    }, { ...callContext, parent: undefined });
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: parseEvent({
            ...unparentedNative,
            data: { ...unparentedNative.data, messageId: "native-parent-message-1" },
          }),
          context: callContext,
        }),
      TypeError,
      "native parent messageId requires saved protocol identity",
    );
    assertThrows(
      () =>
        projectNativeToolEvent({
          event: parseEvent({
            ...native,
            data: {
              ...native.data,
              extensions: {
                ...native.data.extensions,
                [AG_UI_TOOL_PROTOCOL_EXTENSION_URI]: {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "TOOL_CALL_START",
                  identity: { toolCallId: "agui-tool-1", toolCallName: "search" },
                  extensions: { toolCallId: "forged" },
                },
              },
            },
          }),
          context: callContext,
        }),
      TypeError,
      "protocol.agui.extensions must not contain reserved AG-UI field toolCallId",
    );
  });

  it("returns explicit requirements for redacted output and isError instead of guessing", () => {
    const redacted = parseEvent({
      specversion: "1.0",
      id: occurrence.id,
      source: occurrence.source,
      type: "com.veryfront.tool-call.result.recorded",
      datacontenttype: "application/json",
      dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallResultRecorded",
      data: { toolCallId: "native-tool-1", outputRedacted: true },
    });
    const redactedCommand = projectNativeToolEvent({ event: redacted, context: resultContext });
    assertEquals(redactedCommand.kind, "missing-fact-requirement");
    assertEquals(
      redactedCommand.kind === "missing-fact-requirement" ? redactedCommand.reason : undefined,
      "redacted-output",
    );

    const error = parseEvent({
      ...redacted,
      data: { toolCallId: "native-tool-1", output: "failed", isError: true },
    });
    const errorCommand = projectNativeToolEvent({ event: error, context: resultContext });
    assertEquals(errorCommand.kind, "missing-fact-requirement");
    assertEquals(
      errorCommand.kind === "missing-fact-requirement" ? errorCommand.reason : undefined,
      "error-result",
    );
  });
});
