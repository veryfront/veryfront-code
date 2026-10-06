import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgUiEvent, AgUiEventOf } from "./index.ts";
import {
  AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA,
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE,
  createGeneratedSynchronizationFrame,
  parseNativeSynchronizationEvent,
  parseNativeSynchronizationRecord,
  projectAgUiSynchronizationEvent,
  projectNativeSynchronizationEvent,
} from "./native-synchronization.ts";

const occurrence = { source: "https://example.test/ag-ui", id: "sync-1" } as const;

function roundTrip(event: AgUiEvent): AgUiEvent {
  const native = projectAgUiSynchronizationEvent({ event, occurrence });
  assertEquals(native.source, occurrence.source);
  assertEquals(native.id, occurrence.id);
  assertEquals(parseNativeSynchronizationEvent(native), native);
  return projectNativeSynchronizationEvent({ event: native });
}

describe("events/ag-ui/native-synchronization", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    assertEquals(roundTrip({ type: "STATE_SNAPSHOT", snapshot: null, subagentRunId: "" }), {
      type: "STATE_SNAPSHOT",
      snapshot: null,
      subagentRunId: "",
    });
  });

  it("exposes concrete schema documents and validates native records through the registry", () => {
    assertEquals(
      AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA.$defs.StateSnapshotRecorded.required,
      ["state", "protocol"],
    );
    const native = projectAgUiSynchronizationEvent({
      event: { type: "STATE_SNAPSHOT", snapshot: null },
      occurrence,
    });
    assertEquals(
      native.dataschema,
      AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
        "com.veryfront.synchronization.state.snapshot.recorded"
      ],
    );
    assertEquals(parseNativeSynchronizationRecord(native), native);
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...native,
          dataschema: "urn:veryfront:ag-ui:internal:synchronization:state-snapshot:1",
        }),
      TypeError,
      "Invalid native synchronization event",
    );
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...native,
          data: { protocol: native.data.protocol },
        }),
      TypeError,
      "required property 'state'",
    );
  });

  it("round-trips state snapshots and deltas with any JSON state and ordered patches", () => {
    const snapshot: AgUiEventOf<"STATE_SNAPSHOT"> & {
      readonly extensionState: { readonly opaque: boolean };
    } = {
      type: "STATE_SNAPSHOT",
      snapshot: { nested: [1, null, true, { value: "ok" }] },
      timestamp: 42,
      metadata: { trace: "state" },
      rawEvent: { provider: "upstream" },
      subagentRunId: "sub-state",
      extensionState: { opaque: true },
    };
    const delta: AgUiEventOf<"STATE_DELTA"> = {
      type: "STATE_DELTA",
      delta: [
        { op: "add", path: "", value: [null, "root"] },
        { op: "add", path: "/items/0", value: { id: "a" } },
        { op: "replace", path: "/items/0/id", value: "b" },
        { op: "copy", from: "/items/0", path: "/items/1" },
        { op: "move", from: "/items/1", path: "/items/2" },
        { op: "remove", path: "/items/2" },
        { op: "test", path: "/items/0/id", value: "b" },
      ],
      metadata: { trace: "delta" },
      subagentRunId: "sub-state",
    };

    for (const value of [null, true, 1, "scalar", [null, "root"], snapshot.snapshot]) {
      assertEquals(roundTrip({ type: "STATE_SNAPSHOT", snapshot: value }), {
        type: "STATE_SNAPSHOT",
        snapshot: value,
      });
    }

    const nativeSnapshot = projectAgUiSynchronizationEvent({ event: snapshot, occurrence });
    assertEquals(nativeSnapshot.type, "com.veryfront.synchronization.state.snapshot.recorded");
    if (nativeSnapshot.type !== "com.veryfront.synchronization.state.snapshot.recorded") return;
    assertEquals(nativeSnapshot.data.state.snapshot, snapshot.snapshot);
    assertEquals(nativeSnapshot.data.protocol.agui.attribution, {
      invocation: { subagentRunId: "sub-state" },
    });
    assertEquals(roundTrip(snapshot), snapshot);

    const nativeDelta = projectAgUiSynchronizationEvent({ event: delta, occurrence });
    assertEquals(nativeDelta.type, "com.veryfront.synchronization.state.delta.recorded");
    if (nativeDelta.type !== "com.veryfront.synchronization.state.delta.recorded") return;
    assertEquals(nativeDelta.data.state.delta, delta.delta);
    assertEquals(projectNativeSynchronizationEvent({ event: nativeDelta }), delta);
  });

  it("round-trips transcript snapshots with all AG-UI message roles and multimodal content", () => {
    const event: AgUiEvent = {
      type: "MESSAGES_SNAPSHOT",
      metadata: { transcript: "complete" },
      messages: [
        { id: "dev", role: "developer", content: "rules", metadata: { order: 0 } },
        { id: "system", role: "system", content: "system" },
        {
          id: "assistant",
          role: "assistant",
          content: "answer",
          toolCalls: [{
            id: "tool-1",
            type: "function",
            function: { name: "lookup", arguments: "{}" },
          }],
        },
        {
          id: "user",
          role: "user",
          content: [
            { type: "text", text: "inspect", metadata: { segment: 1 } },
            { type: "image", source: { type: "url", value: "https://example.test/i.png" } },
            { type: "audio", source: { type: "data", value: "AAAA", mimeType: "audio/wav" } },
            { type: "video", source: { type: "file", value: "file-video", provider: "store" } },
            { type: "document", source: { type: "data", value: "doc", mimeType: "text/plain" } },
          ],
        },
        { id: "tool", role: "tool", toolCallId: "tool-1", content: "result" },
        { id: "activity", role: "activity", activityType: "plan", content: { step: 1 } },
        { id: "reasoning", role: "reasoning", content: "thinking", encryptedValue: "opaque" },
      ],
    };

    const native = projectAgUiSynchronizationEvent({ event, occurrence });
    assertEquals(native.type, "com.veryfront.synchronization.transcript.snapshot.recorded");
    if (native.type !== "com.veryfront.synchronization.transcript.snapshot.recorded") return;
    assertEquals(native.data.transcript.messages.map((message) => message.role), [
      "developer",
      "system",
      "assistant",
      "user",
      "tool",
      "activity",
      "reasoning",
    ]);
    assertEquals(projectNativeSynchronizationEvent({ event: native }), event);
  });

  it("round-trips activity replacement and ordered patches with invocation attribution", () => {
    const snapshot: AgUiEvent = {
      type: "ACTIVITY_SNAPSHOT",
      messageId: "activity-1",
      activityType: "plan",
      content: { items: ["a"] },
      replace: true,
      subagentRunId: "sub-activity",
      metadata: { display: "timeline" },
    };
    const delta: AgUiEvent = {
      type: "ACTIVITY_DELTA",
      messageId: "activity-1",
      activityType: "plan",
      patch: [
        { op: "replace", path: "/items/0", value: "b" },
        { op: "add", path: "/items/1", value: "c" },
      ],
      subagentRunId: "sub-activity",
    };

    assertEquals(roundTrip(snapshot), snapshot);
    assertEquals(roundTrip(delta), delta);
  });

  it("rejects registry/schema malformed payloads that AG-UI parsing rejects", () => {
    const delta = projectAgUiSynchronizationEvent({
      event: { type: "STATE_DELTA", delta: [{ op: "add", path: "/a", value: 1 }] },
      occurrence,
    });
    const malformedPatches = [
      [{ op: "unsupported", path: "/x" }],
      [{ op: "add", path: "/x" }],
      [{ op: "move", path: "/x" }],
      [{ op: "remove" }],
    ];
    for (const patch of malformedPatches) {
      assertThrows(
        () =>
          parseNativeSynchronizationRecord({
            ...delta,
            data: { ...delta.data, state: { delta: patch } },
          }),
        TypeError,
        "Invalid native synchronization event",
      );
    }

    const transcript = projectAgUiSynchronizationEvent({
      event: {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "m", role: "user", content: "hello" }],
      },
      occurrence,
    });
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...transcript,
          data: { ...transcript.data, transcript: { messages: [{ id: "m", role: "alien" }] } },
        }),
      TypeError,
      "Invalid native synchronization event",
    );

    const activity = projectAgUiSynchronizationEvent({
      event: {
        type: "ACTIVITY_SNAPSHOT",
        messageId: "activity",
        activityType: "plan",
        content: { ok: true },
      },
      occurrence,
    });
    assertEquals(activity.type, "com.veryfront.synchronization.activity.snapshot.recorded");
    if (activity.type !== "com.veryfront.synchronization.activity.snapshot.recorded") return;
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...activity,
          data: { ...activity.data, activity: { ...activity.data.activity, content: "scalar" } },
        }),
      TypeError,
      "Invalid native synchronization event",
    );
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...activity,
          data: {
            ...activity.data,
            activity: { ...activity.data.activity, extra: true },
          },
        }),
      TypeError,
      "Invalid native synchronization event",
    );
  });

  it("rejects non-data JSON inputs at the bounded boundary before schema validation", () => {
    const native = projectAgUiSynchronizationEvent({
      event: { type: "STATE_SNAPSHOT", snapshot: { ok: true } },
      occurrence,
    });
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...native,
          data: { ...native.data, state: { snapshot: new Date("2026-10-06T00:00:00.000Z") } },
        }),
      TypeError,
      "bounded data-only JSON",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...native,
          data: { ...native.data, state: { snapshot: cyclic } },
        }),
      TypeError,
      "bounded data-only JSON",
    );
    class Box {}
    assertThrows(
      () =>
        parseNativeSynchronizationRecord({
          ...native,
          data: { ...native.data, state: { snapshot: new Box() } },
        }),
      TypeError,
      "bounded data-only JSON",
    );
  });

  it("keeps durable source/id authoritative and metadata non-authoritative", () => {
    const native = projectAgUiSynchronizationEvent({
      event: {
        type: "STATE_SNAPSHOT",
        snapshot: { ok: true },
        metadata: { source: "forged-source", id: "forged-id" },
      },
      occurrence: { source: "https://trusted.example/producer", id: "trusted-id" },
    });

    assertEquals(native.source, "https://trusted.example/producer");
    assertEquals(native.id, "trusted-id");
    assertEquals(native.data.protocol.agui.metadata, { source: "forged-source", id: "forged-id" });
    assertEquals(projectNativeSynchronizationEvent({ event: native }), {
      type: "STATE_SNAPSHOT",
      snapshot: { ok: true },
      metadata: { source: "forged-source", id: "forged-id" },
    });
  });

  it("models generated read frames without durable occurrence identity", () => {
    const frame = createGeneratedSynchronizationFrame({
      type: "STATE_SNAPSHOT",
      snapshot: { read: true },
      metadata: { generated: true },
    });

    assertEquals(frame.kind, "generated-read-frame");
    assertEquals(frame.event, {
      type: "STATE_SNAPSHOT",
      snapshot: { read: true },
      metadata: { generated: true },
    });
    assert(!("id" in frame));
    assert(!("source" in frame));
  });

  it("rejects native extension payloads that try to override reserved AG-UI fields", () => {
    const native = projectAgUiSynchronizationEvent({
      event: {
        type: "STATE_SNAPSHOT",
        snapshot: { ok: true },
        metadata: { trusted: true },
        subagentRunId: "trusted-lane",
        extensionState: { ok: true },
      },
      occurrence,
    });

    assertThrows(
      () =>
        projectNativeSynchronizationEvent({
          event: {
            ...native,
            data: {
              ...native.data,
              protocol: {
                agui: {
                  ...native.data.protocol.agui,
                  extensions: {
                    ...native.data.protocol.agui.extensions,
                    metadata: { forged: true },
                  },
                },
              },
            },
          },
        }),
      TypeError,
      "reserved AG-UI field metadata",
    );
    assertThrows(
      () =>
        projectNativeSynchronizationEvent({
          event: {
            ...native,
            data: {
              ...native.data,
              protocol: {
                agui: {
                  ...native.data.protocol.agui,
                  extensions: { subagentRunId: "forged-lane" },
                },
              },
            },
          },
        }),
      TypeError,
      "reserved AG-UI field subagentRunId",
    );
  });

  it("rejects unsupported or lossy synchronization payloads", () => {
    assertThrows(
      () =>
        projectAgUiSynchronizationEvent({
          event: {
            type: "RUN_FINISHED",
            threadId: "thread",
            runId: "run",
          },
          occurrence,
        }),
      TypeError,
      "not an AG-UI synchronization event",
    );
    const native = projectAgUiSynchronizationEvent({
      event: { type: "STATE_DELTA", delta: [{ op: "add", path: "/a", value: 1 }] },
      occurrence,
    });
    assertThrows(
      () =>
        projectNativeSynchronizationEvent({
          event: {
            ...native,
            data: {
              ...native.data,
              state: { delta: [{ op: "add", path: "not-json-pointer", value: 1 }] },
            },
          },
        }),
      TypeError,
    );
    const reservedNative = projectAgUiSynchronizationEvent({
      event: {
        type: "STATE_SNAPSHOT",
        snapshot: { ok: true },
        metadata: { trusted: true },
        extensionState: { ok: true },
      },
      occurrence,
    });
    assertThrows(
      () =>
        parseNativeSynchronizationEvent({
          ...reservedNative,
          data: {
            ...reservedNative.data,
            protocol: {
              agui: {
                ...reservedNative.data.protocol.agui,
                extensions: { metadata: { forged: true } },
              },
            },
          },
        }),
      TypeError,
      "reserved AG-UI field metadata",
    );
  });
});
