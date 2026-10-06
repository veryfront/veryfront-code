import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgUiEventOf } from "./types.ts";
import {
  AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE,
  createGeneratedInvocationFrame,
  parseNativeInvocationEvent,
  parseNativeInvocationRecord,
  projectAgUiInvocationEvent,
  projectNativeInvocationEvent,
} from "./native-invocation.ts";
import type { AgUiInvocationProjectionContext } from "./native-invocation.ts";

const context: AgUiInvocationProjectionContext = {
  occurrence: {
    source: "https://example.test/ag-ui/invocation",
    id: "invocation-occurrence-1",
    time: "2026-10-06T12:00:00.000Z",
  },
  runid: "native-run-1",
  runkind: "agent",
  conversationid: "conversation-1",
} as const;

function canonical(
  event: AgUiEventOf<"SUBAGENT_STARTED" | "SUBAGENT_FINISHED" | "SUBAGENT_ERROR">,
) {
  const command = projectAgUiInvocationEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind !== "canonical-event") throw new Error(command.message);
  return command;
}

describe("events/ag-ui/native-invocation", () => {
  it("roundtrips upstream-valid empty invocation and parent protocol identifiers", () => {
    const event: AgUiEventOf<"SUBAGENT_STARTED"> = {
      type: "SUBAGENT_STARTED",
      subagentRunId: "",
      name: "researcher",
      parentSubagentRunId: "",
      parentToolCallId: "",
      parentMessageId: "",
    };
    const command = canonical(event);
    assertEquals(projectNativeInvocationEvent({ event: command.event }), event);
  });

  it("projects SUBAGENT_STARTED to internal invocation.started with exact occurrence identity", () => {
    const event: AgUiEventOf<"SUBAGENT_STARTED"> & {
      readonly extensionInvocation: { readonly opaque: true };
    } = {
      type: "SUBAGENT_STARTED",
      subagentRunId: "subagent-1",
      name: "researcher",
      description: "Research lane",
      parentSubagentRunId: "parent-subagent",
      parentToolCallId: "tool-call-1",
      parentMessageId: "message-1",
      timestamp: 100,
      rawEvent: { provider: "upstream" },
      metadata: { trace: "start" },
      extensionInvocation: { opaque: true },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.invocation.started");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE["com.veryfront.invocation.started"],
    );
    assertEquals(command.event.source, context.occurrence.source);
    assertEquals(command.event.id, context.occurrence.id);
    assertEquals(command.event.runid, context.runid);
    if (command.event.type !== "com.veryfront.invocation.started") return;
    assertEquals(command.event.data.invocation, {
      subagentRunId: "subagent-1",
      name: "researcher",
      description: "Research lane",
    });
    assertEquals(command.event.data.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "SUBAGENT_STARTED",
      timestamp: 100,
      rawEvent: { provider: "upstream" },
      metadata: { trace: "start" },
      extensions: { extensionInvocation: { opaque: true } },
      attribution: {
        parent: {
          invocation: { subagentRunId: "parent-subagent" },
          tool: { toolCallId: "tool-call-1" },
          message: { messageId: "message-1" },
        },
      },
    });
    assertEquals(parseNativeInvocationRecord(command.event), command.event);
    assertEquals(parseNativeInvocationEvent(command.event), command.event);
    assertEquals(projectNativeInvocationEvent({ event: command.event }), event);
  });

  it("projects SUBAGENT_FINISHED success and absent outcome to invocation.succeeded", () => {
    const withOutcome: AgUiEventOf<"SUBAGENT_FINISHED"> = {
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      result: { status: "done" },
      outcome: { type: "success" },
      metadata: { trace: "finish" },
    };
    const withoutOutcome: AgUiEventOf<"SUBAGENT_FINISHED"> = {
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-2",
    };

    const command = canonical(withOutcome);
    assertEquals(command.event.type, "com.veryfront.invocation.succeeded");
    if (command.event.type !== "com.veryfront.invocation.succeeded") return;
    assertEquals(command.event.data.invocation, {
      subagentRunId: "subagent-1",
      result: { status: "done" },
      outcome: { type: "success" },
    });
    assertEquals(projectNativeInvocationEvent({ event: command.event }), withOutcome);

    const absent = canonical(withoutOutcome);
    assertEquals(absent.event.type, "com.veryfront.invocation.succeeded");
    if (absent.event.type !== "com.veryfront.invocation.succeeded") return;
    assertEquals(absent.event.data.invocation, { subagentRunId: "subagent-2" });
    assertEquals(projectNativeInvocationEvent({ event: absent.event }), withoutOutcome);
  });

  it("projects SUBAGENT_FINISHED suspended outcome to invocation.paused", () => {
    const event: AgUiEventOf<"SUBAGENT_FINISHED"> = {
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      result: { progress: "waiting" },
      outcome: { type: "suspended", interruptIds: ["interrupt-1", "interrupt-2"] },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.invocation.paused");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE["com.veryfront.invocation.paused"],
    );
    if (command.event.type !== "com.veryfront.invocation.paused") return;
    assertEquals(command.event.data.invocation.outcome, {
      type: "suspended",
      interruptIds: ["interrupt-1", "interrupt-2"],
    });
    assertEquals(projectNativeInvocationEvent({ event: command.event }), event);
  });

  it("projects SUBAGENT_ERROR to invocation.failed", () => {
    const event: AgUiEventOf<"SUBAGENT_ERROR"> = {
      type: "SUBAGENT_ERROR",
      subagentRunId: "subagent-1",
      message: "child failed",
      code: "CHILD_FAILED",
      metadata: { trace: "error" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.invocation.failed");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE["com.veryfront.invocation.failed"],
    );
    if (command.event.type !== "com.veryfront.invocation.failed") return;
    assertEquals(command.event.data.invocation, {
      subagentRunId: "subagent-1",
      message: "child failed",
      code: "CHILD_FAILED",
    });
    assertEquals(projectNativeInvocationEvent({ event: command.event }), event);
  });

  it("rejects malformed payloads and wrong invocation outcome pairings", () => {
    const paused = canonical({
      type: "SUBAGENT_FINISHED",
      subagentRunId: "subagent-1",
      outcome: { type: "suspended", interruptIds: ["interrupt-1"] },
    });
    if (paused.event.type !== "com.veryfront.invocation.paused") return;

    assertThrows(
      () =>
        parseNativeInvocationRecord({
          ...paused.event,
          data: {
            ...paused.event.data,
            invocation: {
              subagentRunId: "subagent-1",
              outcome: { type: "suspended", interruptIds: [1] },
            },
          },
        }),
      TypeError,
      "Invalid native invocation event",
    );

    assertThrows(
      () =>
        parseNativeInvocationRecord({
          ...paused.event,
          data: {
            ...paused.event.data,
            invocation: {
              ...paused.event.data.invocation,
              outcome: { type: "success" },
            },
          },
        }),
      TypeError,
      "Invalid native invocation event",
    );

    const failed = canonical({
      type: "SUBAGENT_ERROR",
      subagentRunId: "subagent-1",
      message: "child failed",
    });
    if (failed.event.type !== "com.veryfront.invocation.failed") return;
    assertThrows(
      () =>
        parseNativeInvocationRecord({
          ...failed.event,
          data: {
            ...failed.event.data,
            invocation: { subagentRunId: "subagent-1", code: "MISSING_MESSAGE" },
          },
        }),
      TypeError,
      "Invalid native invocation event",
    );
  });

  it("rejects reserved-field overrides in protocol extensions on reverse projection", () => {
    const command = canonical({
      type: "SUBAGENT_STARTED",
      subagentRunId: "subagent-1",
      name: "researcher",
    });
    if (command.event.type !== "com.veryfront.invocation.started") return;

    assertThrows(
      () =>
        projectNativeInvocationEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              protocol: {
                agui: {
                  ...command.event.data.protocol.agui,
                  extensions: { name: "forged", parentToolCallId: "forged-tool" },
                },
              },
            },
          },
        }),
      TypeError,
      "protocol.agui.extensions must not contain reserved AG-UI field name",
    );
  });

  it("keeps generated invocation frames without durable identity", () => {
    const frame = createGeneratedInvocationFrame({
      type: "SUBAGENT_STARTED",
      subagentRunId: "subagent-1",
      name: "researcher",
      parentToolCallId: "tool-call-1",
    });
    assertEquals(frame.kind, "generated-read-frame");
    assert(!("id" in frame));
    assert(!("source" in frame));
    assertEquals(frame.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "SUBAGENT_STARTED",
      attribution: { parent: { tool: { toolCallId: "tool-call-1" } } },
    });
  });
});
