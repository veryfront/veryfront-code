import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE,
  createGeneratedSignalFrame,
  parseNativeSignalEvent,
  parseNativeSignalRecord,
  projectAgUiSignalEvent,
  projectNativeSignalEvent,
} from "./native-signal.ts";
import type { AgUiSignalProjectionContext } from "./native-signal.ts";
import type { AgUiEventOf } from "./types.ts";

const context: AgUiSignalProjectionContext = {
  occurrence: {
    source: "https://example.test/ag-ui/signals",
    id: "signal-occurrence-1",
    time: "2026-10-06T12:00:00.000Z",
  },
  runid: "native-run-1",
  runkind: "agent",
  conversationid: "conversation-1",
} as const;

function canonical(event: AgUiEventOf<"RAW" | "CUSTOM">) {
  const command = projectAgUiSignalEvent({ event, context });
  assertEquals(command.kind, "canonical-event");
  if (command.kind !== "canonical-event") throw new Error(command.message);
  return command;
}

describe("events/ag-ui/native-signal", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    const event: AgUiEventOf<"RAW"> = {
      type: "RAW",
      event: { providerEvent: "token" },
      source: "provider.raw",
      subagentRunId: "",
    };
    const command = canonical(event);
    assertEquals(projectNativeSignalEvent({ event: command.event }), event);
  });

  it("projects RAW to internal raw signal with exact occurrence identity and metadata", () => {
    const event: AgUiEventOf<"RAW"> & { readonly extensionSignal: { readonly opaque: true } } = {
      type: "RAW",
      event: { providerEvent: "token", nested: [1, true, null] },
      source: "provider.raw",
      timestamp: 100,
      rawEvent: { transport: "sse" },
      metadata: { trace: "raw" },
      subagentRunId: "subagent-1",
      extensionSignal: { opaque: true },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.signal.raw.recorded");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE["com.veryfront.signal.raw.recorded"],
    );
    assertEquals(command.event.source, context.occurrence.source);
    assertEquals(command.event.id, context.occurrence.id);
    assertEquals(command.event.runid, context.runid);
    if (command.event.type !== "com.veryfront.signal.raw.recorded") return;
    assertEquals(command.event.data.signal, {
      event: { providerEvent: "token", nested: [1, true, null] },
      source: "provider.raw",
    });
    assertEquals(Object.keys(command.event.data).sort(), ["protocol", "signal"]);
    assertEquals(command.event.data.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "RAW",
      timestamp: 100,
      rawEvent: { transport: "sse" },
      metadata: { trace: "raw" },
      extensions: { extensionSignal: { opaque: true } },
      attribution: { invocation: { subagentRunId: "subagent-1" } },
    });
    assertEquals(parseNativeSignalRecord(command.event), command.event);
    assertEquals(parseNativeSignalEvent(command.event), command.event);
    assertEquals(projectNativeSignalEvent({ event: command.event }), event);
  });

  it("projects CUSTOM names as inert signals without authority grants", () => {
    const event: AgUiEventOf<"CUSTOM"> = {
      type: "CUSTOM",
      name: "vendor.admission.grant",
      value: { resource: "tool:delete", allow: true },
      metadata: { authority: "ignored" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.signal.custom.recorded");
    assertEquals(
      command.event.dataschema,
      AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE["com.veryfront.signal.custom.recorded"],
    );
    if (command.event.type !== "com.veryfront.signal.custom.recorded") return;
    assertEquals(command.event.data.signal, {
      name: "vendor.admission.grant",
      value: { resource: "tool:delete", allow: true },
    });
    assert(!("authority" in command.event.data));
    assert(!("admission" in command.event.data));
    assertEquals(projectNativeSignalEvent({ event: command.event }), event);
  });

  it("returns requirements or rejects malformed non-data signal payloads without invoking accessors", () => {
    const dateCommand = projectAgUiSignalEvent({
      event: { type: "CUSTOM", name: "vendor.date", value: new Date("2026-10-06T12:00:00.000Z") },
      context,
    });
    assertEquals(dateCommand.kind, "missing-fact-requirement");
    if (dateCommand.kind !== "missing-fact-requirement") return;
    assertEquals(dateCommand.reason, "non-json-protocol-signal");

    let getterInvoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "leak";
      },
    });
    const accessorCommand = projectAgUiSignalEvent({
      event: { type: "RAW", event: accessor },
      context,
    });
    assertEquals(accessorCommand.kind, "missing-fact-requirement");
    if (accessorCommand.kind !== "missing-fact-requirement") return;
    assertEquals(accessorCommand.reason, "non-json-protocol-signal");
    assertEquals(getterInvoked, false);

    const command = canonical({ type: "CUSTOM", name: "vendor.ok", value: { ok: true } });
    if (command.event.type !== "com.veryfront.signal.custom.recorded") return;
    const cycle: Record<string, unknown> = { ok: true };
    cycle.self = cycle;
    assertThrows(
      () =>
        parseNativeSignalRecord({
          ...command.event,
          data: { ...command.event.data, signal: { name: "vendor.cycle", value: cycle } },
        }),
      TypeError,
      "native signal event must be bounded data-only JSON",
    );
  });

  it("rejects reserved AG-UI fields inside protocol extensions on reverse projection", () => {
    const command = canonical({ type: "CUSTOM", name: "vendor.signal", value: { ok: true } });
    if (command.event.type !== "com.veryfront.signal.custom.recorded") return;

    assertThrows(
      () =>
        projectNativeSignalEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              protocol: {
                agui: {
                  ...command.event.data.protocol.agui,
                  extensions: { name: "forged" },
                },
              },
            },
          },
        }),
      TypeError,
      "protocol.agui.extensions must not contain reserved AG-UI field name",
    );
  });

  it("rejects wrong native type/protocol pairings", () => {
    const command = canonical({ type: "RAW", event: { ok: true } });
    if (command.event.type !== "com.veryfront.signal.raw.recorded") return;

    assertThrows(
      () =>
        projectNativeSignalEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              protocol: {
                agui: {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "CUSTOM",
                },
              },
            },
          },
        }),
      TypeError,
      "Invalid native signal event",
    );
  });

  it("keeps generated signal frames without durable identity", () => {
    const frame = createGeneratedSignalFrame({
      type: "CUSTOM",
      name: "vendor.signal",
      value: { ok: true },
    });
    assertEquals(frame.kind, "generated-read-frame");
    assert(!("id" in frame));
    assert(!("source" in frame));
    assertEquals(frame.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "CUSTOM",
    });
  });
});
