import { appendConversationRunEvents } from "#veryfront/agent/conversation/durable.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiEncoderState,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";

import {
  getConversationRunEventJsonByteLength,
  MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
  normalizeConversationRunEvents,
} from "#veryfront/agent/conversation/run-event-normalization.ts";

describe("observation encoder private intrinsics", () => {
  it("preserves observed tool inputs when project code replaces JSON.stringify", () => {
    const original = JSON.stringify;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      JSON.stringify = () => {
        throw new Error("project replacement");
      };
      events = mapRuntimeStreamEventToAgUiEvents(createAgUiEncoderState(), {
        type: "tool-input-available",
        toolCallId: "tool-observed",
        toolName: "lookup",
        input: { query: "exact input" },
      });
    } finally {
      JSON.stringify = original;
    }
    const args = events.find((event) => event.event === "ToolCallArgs");
    assertEquals(args?.payload.delta, '{"query":"exact input"}');
  });

  it("preserves direct tool arguments and closure when project code replaces Set operations", () => {
    const NativeSet = Set;
    const methods = Object.getOwnPropertyDescriptors(NativeSet.prototype);
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      NativeSet.prototype.has = () => true;
      NativeSet.prototype.add = () => {
        throw new Error("project add replacement");
      };
      NativeSet.prototype.delete = () => {
        throw new Error("project delete replacement");
      };
      globalThis.Set = new Proxy(NativeSet, {
        construct() {
          throw new Error("project constructor replacement");
        },
      });
      const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
      state.openToolCallIds = undefined;
      events = mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-start",
        toolCallId: "observed",
        toolName: "lookup",
      });
      events.push(...mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-available",
        toolCallId: "observed",
        toolName: "lookup",
        input: { query: "exact input" },
      }));
    } finally {
      globalThis.Set = NativeSet;
      Object.defineProperties(NativeSet.prototype, methods);
    }
    assertEquals(
      events.filter((event) => event.event === "ToolCallArgs").map((event) => event.payload.delta),
      ['{"query":"exact input"}'],
    );
    assertEquals(events.filter((event) => event.event === "ToolCallEnd").length, 1);
  });

  it("does not duplicate streamed tool arguments when project Set.has lies", () => {
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    mapRuntimeStreamEventToAgUiEvents(state, {
      type: "tool-input-delta",
      toolCallId: "streamed",
      inputTextDelta: '{"query":"exact input"}',
    });
    const has = Set.prototype.has;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      Set.prototype.has = () => false;
      events = mapRuntimeStreamEventToAgUiEvents(state, {
        type: "tool-input-available",
        toolCallId: "streamed",
        toolName: "lookup",
        input: { query: "exact input" },
      });
    } finally {
      Set.prototype.has = has;
    }
    assertEquals(events.filter((event) => event.event === "ToolCallArgs").length, 0);
    assertEquals(events.filter((event) => event.event === "ToolCallEnd").length, 1);
  });

  it("preserves custom observations when project code replaces string methods", () => {
    const startsWith = String.prototype.startsWith;
    const slice = String.prototype.slice;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      String.prototype.startsWith = () => false;
      String.prototype.slice = () => "";
      events = mapRuntimeStreamEventToAgUiEvents(
        createAgUiEncoderState({ nowMs: null, epochMs: null }),
        {
          type: "data-message-metadata",
          data: { status: "running" },
        },
      );
    } finally {
      String.prototype.startsWith = startsWith;
      String.prototype.slice = slice;
    }
    assertEquals(events, [{
      event: "Custom",
      payload: { name: "message-metadata", value: { status: "running" } },
    }]);
  });
});

describe("observation normalization private intrinsics", () => {
  it("preserves text, reasoning and tool observations when project JSON is replaced", () => {
    const events = [
      { type: "TEXT_MESSAGE_CONTENT", delta: "exact text" },
      { type: "REASONING_MESSAGE_CONTENT", delta: "exact reasoning" },
      { type: "TOOL_CALL_ARGS", toolCallId: "tool-observed", delta: '{"query":"exact input"}' },
    ];
    const stringify = JSON.stringify;
    let normalized: ReturnType<typeof normalizeConversationRunEvents> = [];
    try {
      JSON.stringify = () => {
        throw new Error("project replacement");
      };
      normalized = normalizeConversationRunEvents(events);
    } finally {
      JSON.stringify = stringify;
    }
    assertEquals(normalized, events);
  });

  it("splits oversized text without losing data when project byte and slice methods are replaced", () => {
    const delta = "escaped\n".repeat(50_000);
    const encode = TextEncoder.prototype.encode;
    const slice = String.prototype.slice;
    let normalized: ReturnType<typeof normalizeConversationRunEvents> = [];
    try {
      TextEncoder.prototype.encode = () => new Uint8Array();
      String.prototype.slice = () => "";
      normalized = normalizeConversationRunEvents([{ type: "TEXT_MESSAGE_CONTENT", delta }]);
    } finally {
      TextEncoder.prototype.encode = encode;
      String.prototype.slice = slice;
    }
    assertEquals(normalized.length > 1, true);
    assertEquals(normalized.map((event) => event.delta).join(""), delta);
    assertEquals(
      normalized.every((event) =>
        getConversationRunEventJsonByteLength(event) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
      ),
      true,
    );
  });
});

describe("observation append serialization", () => {
  it("persists the data-only representation used by normalization without invoking toJSON", async () => {
    let toJsonCalls = 0;
    const event = {
      type: "CUSTOM",
      name: "owned-data",
      value: {
        preserved: "exact data",
        cells: new Array(100_001).fill(0),
        toJSON() {
          toJsonCalls++;
          return "x".repeat(300 * 1024);
        },
      },
    };
    let requestBody = "";
    const canonicalRunId = "11111111-1111-4111-8111-111111111111";
    await appendConversationRunEvents({
      canonicalRunId,
      authToken: "synthetic-auth-token",
      apiUrl: "https://api.fixture.invalid",
      conversationId: "22222222-2222-4222-8222-222222222222",
      runId: "run_fixture",
      expectedPreviousEventId: 0,
      expectedPreviousExternalEventSequence: 0,
      events: [event, event],
      fetch: (_url, init) => {
        requestBody = String(init?.body);
        return Promise.resolve(Response.json({
          run_id: canonicalRunId,
          latest_event_id: 1,
          latest_external_event_sequence: 1,
          appended_count: 2,
        }));
      },
    });
    assertEquals(toJsonCalls, 0);
    const sent = JSON.parse(requestBody).events[0];
    assertEquals(sent, {
      type: "CUSTOM",
      name: "owned-data",
      value: { preserved: "exact data", cells: new Array(100_001).fill(0) },
    });
    assertEquals(
      getConversationRunEventJsonByteLength(sent),
      getConversationRunEventJsonByteLength(event),
    );
  });
});
