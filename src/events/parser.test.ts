import "#veryfront/schemas/_test-setup.ts";
import "./test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AGENT_EVENT_SCHEMA_BY_TYPE,
  AGENT_EVENT_TARGET_CATALOG,
  AGENT_EVENT_TARGET_ENVELOPE_SCHEMA,
  AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES,
  AGENT_EVENT_TYPES,
  type AgentEvent,
  parseAgentEvent,
  safeParseAgentEvent,
} from "./index.ts";

type TargetExample =
  | typeof AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.examples[number]
  | typeof AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.negativeCases[number];

type EnvelopeContext = TargetExample["envelopeContext"];

function targetExamples(): typeof AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.examples {
  return AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.examples;
}

function targetNegativeCases(): typeof AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.negativeCases {
  return AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES.negativeCases;
}

function definedEnvelopeContext(
  context: EnvelopeContext,
): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      defined[key] = value;
    }
  }
  return defined;
}

function eventFor(example: TargetExample): Record<string, unknown> {
  return {
    specversion: "1.0",
    id: example.id,
    source: "https://example.test/producer",
    type: example.eventType,
    datacontenttype: "application/json",
    dataschema: example.schemaRef,
    data: structuredClone(example.data),
    ...definedEnvelopeContext(example.envelopeContext),
  };
}

describe("events/parser", () => {
  it("exports the 36 target types from the pinned catalog in order", () => {
    const catalogTypes = AGENT_EVENT_TARGET_CATALOG.events.map((event) => event.type);
    assertEquals(AGENT_EVENT_TYPES.length, 36);
    assertEquals([...AGENT_EVENT_TYPES], catalogTypes);
    assertEquals(
      Object.keys(AGENT_EVENT_SCHEMA_BY_TYPE),
      catalogTypes,
    );
  });

  it("parses every positive target fixture as an AgentEvent", () => {
    assertEquals(targetExamples().length, 99);
    for (const example of targetExamples()) {
      const event = parseAgentEvent(eventFor(example));
      assertEquals(event.type, example.eventType);
      assertEquals(event.dataschema, example.schemaRef);
      assertEquals<unknown>(event.data, example.data);
    }
  });

  it("rejects every negative target fixture", () => {
    assertEquals(targetNegativeCases().length, 271);
    for (const example of targetNegativeCases()) {
      const result = safeParseAgentEvent(eventFor(example));
      assert(!result.success, `${example.id} unexpectedly parsed`);
    }
  });

  it("enforces exact dataschema selection for the event type", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.run.started"
    );
    assert(example);
    const result = safeParseAgentEvent({
      ...eventFor(example),
      dataschema: "urn:example:wrong-schema",
    });
    assert(!result.success);
  });

  it("rejects legacy envelope wrappers and duplicated payload type fields", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.run.started"
    );
    assert(example);
    assert(!safeParseAgentEvent({ ...eventFor(example), payload: {} }).success);
    assert(!safeParseAgentEvent({ ...eventFor(example), event_type: example.eventType }).success);
    assert(
      !safeParseAgentEvent({ ...eventFor(example), data: { type: example.eventType } }).success,
    );
  });

  it("enforces model-call usage scope and token subset semantics", () => {
    const attempt = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.model-call.usage.recorded" &&
      candidate.data.scope === "attempt"
    );
    const call = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.model-call.usage.recorded" &&
      candidate.data.scope === "call"
    );
    assert(attempt);
    assert(call);

    const missingAttempt = eventFor(attempt);
    delete missingAttempt.attemptid;
    assert(!safeParseAgentEvent(missingAttempt).success);
    assert(!safeParseAgentEvent({ ...eventFor(call), attemptid: "attempt-a" }).success);
    assert(
      !safeParseAgentEvent({
        ...eventFor(call),
        data: { ...call.data, tokens: { input: 5, output: 4, cacheRead: 6 } },
      }).success,
    );
  });

  it("rejects recordedat on live stream signals", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.stream.heartbeat.emitted"
    );
    assert(example);
    assert(
      !safeParseAgentEvent({
        ...eventFor(example),
        recordedat: "2026-10-05T10:00:00Z",
      }).success,
    );
  });

  it("rejects invalid CloudEvents string values on extension attributes", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.run.started"
    );
    assert(example);
    for (
      const [name, value] of [
        ["control", "bad\u0001"],
        ["surrogate", "bad\uD800"],
        ["noncharacter", "bad\uFDD0"],
      ]
    ) {
      const result = safeParseAgentEvent({
        ...eventFor(example),
        customtag: value,
      });
      assert(!result.success, `${name} customtag unexpectedly parsed`);
      assertEquals(result.issues[0]?.instancePath, "/customtag");
    }
  });

  it("accepts valid CloudEvents extension attributes and freezes exported schemas", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.run.started"
    );
    assert(example);
    assertThrows(
      () => {
        (AGENT_EVENT_TARGET_ENVELOPE_SCHEMA as { required?: readonly string[] }).required = [];
      },
      TypeError,
    );

    const event = parseAgentEvent({
      ...eventFor(example),
      customtag: true,
    });
    assertEquals("customtag" in event && event.customtag, true);
  });

  it("accepts blank tracestate list members without counting them", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.run.started"
    );
    assert(example);
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    assert(
      safeParseAgentEvent({
        ...eventFor(example),
        traceparent,
        tracestate: "a=b,, 	 ,c=d",
      }).success,
    );
    assert(
      safeParseAgentEvent({
        ...eventFor(example),
        traceparent,
        tracestate: `${Array.from({ length: 32 }, (_, index) => `k${index}=v`).join(",")},,`,
      }).success,
    );
    assert(
      !safeParseAgentEvent({
        ...eventFor(example),
        traceparent,
        tracestate: Array.from({ length: 33 }, (_, index) => `k${index}=v`).join(","),
      }).success,
    );
    for (const tracestate of ["a=b,\n,c=d", "a=b,\r,c=d", "a=b,\u00a0,c=d"]) {
      assert(
        !safeParseAgentEvent({
          ...eventFor(example),
          traceparent,
          tracestate,
        }).success,
        `${JSON.stringify(tracestate)} unexpectedly parsed`,
      );
    }
  });

  it("keeps AgentEvent discriminated by type for consumers", () => {
    const example = targetExamples().find((candidate) =>
      candidate.eventType === "com.veryfront.stream.closed"
    );
    assert(example);
    const event: AgentEvent = parseAgentEvent(eventFor(example));
    assertEquals(event.type, "com.veryfront.stream.closed");
    if (event.type === "com.veryfront.stream.closed") {
      assertEquals(
        event.dataschema,
        "urn:veryfront:run-events:target:payloads:1#/$defs/StreamClosed",
      );
      const reason: string = event.data.reason;
      assertEquals(reason, "completed");
    }
  });

  it("throws with a concise validation error from parseAgentEvent", () => {
    const error = assertThrows(() => parseAgentEvent({}));
    assert(error instanceof TypeError);
    assert(error.message.startsWith("Invalid Agent Events Protocol event"));
  });
});
