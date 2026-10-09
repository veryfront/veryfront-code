import { readProjectExecutionParent } from "#veryfront/server/handlers/request/project-run-parent.ts";
import { getPrivateRunEventAppendRequestByteLength } from "#veryfront/agent/conversation/run-event-limits.ts";
import {
  appendConversationRunEvents,
  createConversationRunEventQueueController,
} from "#veryfront/agent/conversation/durable.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiEncoderState,
  mapRuntimeStreamEventToAgUiEvents,
  stampAgUiEventTiming,
} from "#veryfront/agent/ag-ui/encoder.ts";

import {
  getConversationRunEventJsonByteLength,
  MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
  normalizeConversationRunEvent,
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

  it("stamps observation timing when project code replaces Object.hasOwn", () => {
    const hasOwn = Object.hasOwn;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      Object.hasOwn = () => true;
      events = mapRuntimeStreamEventToAgUiEvents(
        createAgUiEncoderState({ nowMs: () => 25, epochMs: () => 1_000 }),
        { type: "text-start", id: "text-observed", messageId: "message-observed" },
      );
    } finally {
      Object.hasOwn = hasOwn;
    }
    assertEquals(events.length > 0, true);
    for (const event of events) {
      assertEquals(typeof event.payload.elapsedMs, "number");
      assertEquals(event.payload.emittedAt, 1_000);
    }
  });

  for (
    const replacement of [() => true, () => false, () => {
      throw new Error("mutable ownership check");
    }]
  ) {
    it(`stamps and validates timing with captured ownership (${replacement.toString()})`, () => {
      const state = createAgUiEncoderState({ nowMs: () => 10, epochMs: () => 1_786_866_357_364 });
      const original = Object.hasOwn;
      let stamped;
      let supplied;
      let invalidError: unknown;
      const originalMathMax = Math.max;
      const originalMathRound = Math.round;
      const originalNumberIsFinite = Number.isFinite;
      const originalNumberIsInteger = Number.isInteger;
      try {
        Object.hasOwn = replacement;
        Math.max = () => {
          throw new Error("mutable Math.max");
        };
        Math.round = () => {
          throw new Error("mutable Math.round");
        };
        Number.isFinite = () => {
          throw new Error("mutable Number.isFinite");
        };
        Number.isInteger = () => {
          throw new Error("mutable Number.isInteger");
        };
        stamped = stampAgUiEventTiming(state, [{ event: "Custom", payload: {} }]);
        supplied = stampAgUiEventTiming(state, [{
          event: "Custom",
          payload: { elapsedMs: 12.5, emittedAt: 123 },
        }]);
        try {
          stampAgUiEventTiming(state, [{ event: "Custom", payload: { elapsedMs: undefined } }]);
        } catch (error) {
          invalidError = error;
        }
      } finally {
        Object.hasOwn = original;
        Math.max = originalMathMax;
        Math.round = originalMathRound;
        Number.isFinite = originalNumberIsFinite;
        Number.isInteger = originalNumberIsInteger;
      }
      assertEquals(stamped?.[0]?.payload.elapsedMs, 0);
      assertEquals(stamped?.[0]?.payload.emittedAt, 1_786_866_357_364);
      assertEquals(supplied?.[0]?.payload.elapsedMs, 12.5);
      assertEquals(supplied?.[0]?.payload.emittedAt, 123);
      assertEquals(invalidError instanceof TypeError, true);
    });
  }

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

  it("preserves oversized object evidence despite replaced collection and object intrinsics", () => {
    const originalHas = WeakSet.prototype.has;
    const originalAdd = WeakSet.prototype.add;
    const originalEntries = Object.entries;
    const originalFromEntries = Object.fromEntries;
    const originalIsArray = Array.isArray;
    const content = { answer: "preserved", padding: "x".repeat(300_000) };
    let normalized: ReturnType<typeof normalizeConversationRunEvents> = [];
    try {
      WeakSet.prototype.has = () => true;
      WeakSet.prototype.add = function () {
        return this;
      };
      Object.entries = () => [];
      Object.fromEntries = () => ({});
      Array.isArray = (() => false) as typeof Array.isArray;
      normalized = normalizeConversationRunEvents([{ type: "TOOL_CALL_RESULT", content }]);
    } finally {
      WeakSet.prototype.has = originalHas;
      WeakSet.prototype.add = originalAdd;
      Object.entries = originalEntries;
      Object.fromEntries = originalFromEntries;
      Array.isArray = originalIsArray;
    }
    const result = normalized[0].content as typeof content;
    assertEquals(result.answer, "preserved");
    assertEquals(result.padding.startsWith("xxx"), true);
    assertEquals(
      getConversationRunEventJsonByteLength(normalized[0]) <=
        MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
      true,
    );
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

it("summarizes cyclic public tool results without invoking patched summarizer intrinsics", () => {
  const originalWeakSetHas = WeakSet.prototype.has;
  const originalWeakSetAdd = WeakSet.prototype.add;
  const originalObjectEntries = Object.entries;
  const originalObjectFromEntries = Object.fromEntries;
  const content: Record<string, unknown> = { text: "kept", blob: "x".repeat(300 * 1024) };
  content.self = content;
  let patchedCalls = 0;
  WeakSet.prototype.has = function () {
    patchedCalls++;
    return true;
  };
  WeakSet.prototype.add = function () {
    patchedCalls++;
    return this;
  };
  Object.entries = function () {
    patchedCalls++;
    return [];
  };
  Object.fromEntries = function () {
    patchedCalls++;
    return {};
  };
  try {
    const [result] = normalizeConversationRunEvent({
      type: "TOOL_CALL_RESULT",
      toolCallId: "tc_cyclic_result",
      content,
    });
    assertEquals(patchedCalls, 0);
    assertEquals(result?.type, "TOOL_CALL_RESULT");
    assertEquals((result?.content as Record<string, unknown>).text, "kept");
    assertEquals((result?.content as Record<string, unknown>).self, "[circular]");
    assertEquals(
      getConversationRunEventJsonByteLength(result) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES,
      true,
    );
  } finally {
    WeakSet.prototype.has = originalWeakSetHas;
    WeakSet.prototype.add = originalWeakSetAdd;
    Object.entries = originalObjectEntries;
    Object.fromEntries = originalObjectFromEntries;
  }
});

it("keeps queue capture receipt storage private when Map and string casing methods are patched", async () => {
  const canonicalRunId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const modelCallId = "44444444-4444-4444-8444-444444444444";
  const exactReceiptEventId = "9007199254740993";
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: () =>
      Promise.resolve(
        Response.json({
          run_id: canonicalRunId,
          latest_event_id: 42,
          latest_external_event_sequence: 5,
          appended_count: 1,
          model_call_captures: [{
            event_id: exactReceiptEventId,
            model_call_id: modelCallId,
            run_id: canonicalRunId,
            project_id: projectId,
          }],
        }),
      ),
  });
  const receiptKey = modelCallId.toLowerCase();
  const isSensitiveString = (value: string) => {
    const normalized = originalToLowerCase.call(value);
    return normalized === receiptKey || normalized === canonicalRunId || normalized === projectId;
  };
  const originalMapSet = Map.prototype.set;
  const originalMapGet = Map.prototype.get;
  const originalMapDelete = Map.prototype.delete;
  const originalSetAdd = Set.prototype.add;
  const originalSetHas = Set.prototype.has;
  const originalToLowerCase = String.prototype.toLowerCase;
  let patchedMapCalls = 0;
  let patchedSetCalls = 0;
  let patchedLowerCalls = 0;
  Map.prototype.set = function (this: Map<unknown, unknown>, key, value) {
    if (key === receiptKey) {
      patchedMapCalls++;
      return this;
    }
    return originalMapSet.call(this, key, value);
  };
  Map.prototype.get = function (this: Map<unknown, unknown>, key) {
    if (key === receiptKey) {
      patchedMapCalls++;
      return undefined;
    }
    return originalMapGet.call(this, key);
  };
  Map.prototype.delete = function (this: Map<unknown, unknown>, key) {
    if (key === receiptKey) {
      patchedMapCalls++;
      return false;
    }
    return originalMapDelete.call(this, key);
  };
  Set.prototype.add = function (this: Set<unknown>, value) {
    if (typeof value === "string" && isSensitiveString(value)) {
      patchedSetCalls++;
      return this;
    }
    return originalSetAdd.call(this, value);
  };
  Set.prototype.has = function (this: Set<unknown>, value) {
    if (typeof value === "string" && isSensitiveString(value)) {
      patchedSetCalls++;
      return false;
    }
    return originalSetHas.call(this, value);
  };
  String.prototype.toLowerCase = function () {
    const value = String(this);
    if (isSensitiveString(value)) {
      patchedLowerCalls++;
      return "poisoned";
    }
    return originalToLowerCase.call(this);
  };
  try {
    queue.enqueue([{ type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED", modelCallId, messages: [] }]);
    await queue.flush();
    assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), {
      eventId: exactReceiptEventId,
      modelCallId,
      runId: canonicalRunId,
      projectId,
    });
  } finally {
    Map.prototype.set = originalMapSet;
    Map.prototype.get = originalMapGet;
    Map.prototype.delete = originalMapDelete;
    Set.prototype.add = originalSetAdd;
    Set.prototype.has = originalSetHas;
    String.prototype.toLowerCase = originalToLowerCase;
  }
  assertEquals(patchedMapCalls, 0);
  assertEquals(patchedSetCalls, 0);
  assertEquals(patchedLowerCalls, 0);
});

it("rejects an array descriptor that changes to an accessor at the summary copy boundary", () => {
  const target: unknown[] = ["kept"];
  let descriptorReads = 0;
  let inheritedReads = 0;
  const content = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      if (key === "0" && ++descriptorReads >= 4) {
        return {
          __proto__: null,
          get() {
            throw new Error("own getter must not execute");
          },
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(object, key);
    },
  });
  target.push(content);
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let failure: unknown;
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        inheritedReads++;
        return "injected from inherited getter";
      },
    });
    normalizeConversationRunEvents([{ type: "TOOL_CALL_RESULT", content }]);
  } catch (error) {
    failure = error;
  } finally {
    if (original) Object.defineProperty(Object.prototype, "value", original);
    else Reflect.deleteProperty(Object.prototype, "value");
  }
  assertEquals(failure instanceof TypeError, true);
  assertEquals(inheritedReads, 0);
});

describe("private observation authority and sizing", () => {
  it("validates parent UUID authority after project code replaces RegExp test", () => {
    const canonicalRunId = "11111111-1111-4111-8111-111111111111";
    const token = `test.${
      btoa(JSON.stringify({
        tokenUse: "run_event_writer",
        runId: "parent-run",
        projectId: "parent-project",
        projectExecutionAttempt: { canonicalRunId, attemptId: "attempt", workerId: "worker" },
      }))
    }.signature`;
    const original = RegExp.prototype.test;
    let parent;
    try {
      RegExp.prototype.test = () => {
        throw new Error("project test replacement");
      };
      parent = readProjectExecutionParent(token, "parent-run", "parent-project");
    } finally {
      RegExp.prototype.test = original;
    }
    assertEquals(parent, { canonicalRunId, attemptId: "attempt" });
  });

  it("sizes private model-call events after project code replaces TextEncoder encode", () => {
    const event = { type: "MODEL_CALL_CONTEXT", context: "private input 🚀" };
    const expected = getPrivateRunEventAppendRequestByteLength(event);
    const original = TextEncoder.prototype.encode;
    let actual;
    try {
      TextEncoder.prototype.encode = () => {
        throw new Error("project encode replacement");
      };
      actual = getPrivateRunEventAppendRequestByteLength(event);
    } finally {
      TextEncoder.prototype.encode = original;
    }
    assertEquals(Number.isFinite(expected), true);
    assertEquals(actual, expected);
  });
});
