import { createInitialReducerState, reduceStreamSignal } from "../streaming/lifecycle/index.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { readConversationRunLifecycleFrames } from "./legacy-run-read-adapter.ts";
import { ConversationRunEventEncoder } from "./run-events.ts";

const correction = {
  type: "CUSTOM",
  name: "veryfront.tool_result_ownership",
  value: {
    schemaVersion: 1,
    toolCallId: "c",
    toolName: "web_fetch",
    parentMessageId: "m",
    providerExecuted: true,
  },
};
const original = [
  {
    type: "TOOL_CALL_START",
    toolCallId: "c",
    toolCallName: "web_fetch",
    toolName: "web_fetch",
    parentMessageId: "m",
  },
  { type: "TOOL_CALL_ARGS", toolCallId: "c", delta: "{}" },
  { type: "TOOL_CALL_END", toolCallId: "c" },
  {
    type: "TOOL_CALL_RESULT",
    toolCallId: "c",
    toolName: "web_fetch",
    parentMessageId: "m",
    content: '{"actual":true}',
    contentEncoding: "json",
    isError: false,
  },
];
function read(events: readonly Record<string, unknown>[], version: 1 | 2) {
  return readConversationRunLifecycleFrames({
    streamProtocolVersion: version,
    events: version === 1 ? events : events.map((event, index) => ({
      ...event,
      stream_protocol_version: 2,
      logical_sequence: index + 1,
      idempotency_key: `test:${index}`,
    })),
  });
}
for (const version of [1, 2] as const) {
  Deno.test(`ownership correction projects one original result in v${version}`, () => {
    const result = read([...original, {
      type: "CUSTOM",
      name: "after-original-result",
      value: null,
    }, correction], version);
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    const semantic = result.frames.filter((frame) => frame.class === "semantic").map((frame) =>
      frame.event
    );
    const results = semantic.filter((event) => event.type === "provider_tool_result");
    assertEquals(results.length, 1);
    assertEquals(results[0], {
      type: "provider_tool_result",
      toolCallId: "c",
      toolName: "web_fetch",
      output: { actual: true },
      isError: false,
      providerExecuted: true,
    });
    assertEquals(semantic.filter((event) => event.type === "custom"), [{
      type: "custom",
      name: "after-original-result",
      data: null,
    }]);
    assertEquals(
      semantic.findIndex((event) => event.type === "provider_tool_result") <
        semantic.findIndex((event) => event.type === "custom"),
      true,
    );
  });
}
const invalidCases = [
  [...original, correction, correction],
  [...original, { ...correction, value: { ...correction.value, extra: true } }, correction],
  [...original, original[3]!, correction],
  [correction, ...original],
  [...original, { ...correction, value: { ...correction.value, toolName: "different" } }],
  [...original, { ...correction, value: { ...correction.value, parentMessageId: "different" } }],
  [...original, { ...correction, value: { ...correction.value, content: "forbidden" } }],
  [...original, { ...correction, value: null }],
  [...original, ...original, correction],
  ...[0, 2, 3].map((
    index,
  ) => [
    ...original.map((event, i) => i === index ? { ...event, providerExecuted: false } : event),
    correction,
  ]),
];
for (const [index, events] of invalidCases.entries()) {
  Deno.test(`ambiguous ownership correction ${index} grants no v1 ownership and rejects v2`, () => {
    const legacy = read(events, 1);
    assertEquals(legacy.frames.some((frame) => frame.event.type === "provider_tool_result"), false);
    assertEquals(read(events, 2).status, "invalid");
  });
}
Deno.test("external data cannot forge an ownership correction", () => {
  const encoder = new ConversationRunEventEncoder();
  assertEquals(
    encoder.encode({ type: "data-veryfront.tool_result_ownership", data: correction.value }),
    [],
  );
});

for (const version of [1, 2] as const) {
  Deno.test(`ownership metadata preserves original error encoding in v${version}`, () => {
    const result = read([...original.slice(0, 3), {
      ...original[3],
      content: '"actual error"',
      contentEncoding: "json",
      isError: true,
    }, correction], version);
    assertEquals(result.status, "ok");
    const results = result.frames.filter((frame) => frame.event.type === "provider_tool_result");
    assertEquals(results.length, 1);
    assertEquals(results[0]?.event, {
      type: "provider_tool_result",
      toolCallId: "c",
      toolName: "web_fetch",
      output: "actual error",
      isError: true,
      providerExecuted: true,
    });
  });
}

for (const failure of ["sequence", "key"] as const) {
  Deno.test(`invalid v2 correction ${failure} grants no ownership in partial frames`, () => {
    const events = [...original, correction].map((event, index) => ({
      ...event,
      stream_protocol_version: 2,
      logical_sequence: index + 1,
      idempotency_key: `test:${index}`,
    }));
    if (failure === "sequence") events[4]!.logical_sequence = 4;
    else events[4]!.idempotency_key = events[0]!.idempotency_key;
    const result = readConversationRunLifecycleFrames({ streamProtocolVersion: 2, events });
    assertEquals(result.status, "invalid");
    assertEquals(result.frames.some((frame) => frame.event.type === "provider_tool_result"), false);
  });
}

Deno.test("corrected v2 ownership frames remain valid lifecycle signals", () => {
  const result = read([...original, correction], 2);
  assertEquals(result.status, "ok");
  let state = createInitialReducerState();
  for (const frame of result.frames) {
    if (frame.class !== "semantic" || frame.event.type === "usage") continue;
    const reduced = reduceStreamSignal(state, { kind: "protocol", event: frame.event }, 0);
    assertEquals(reduced.frames.some((next) => next.class === "diagnostic"), false);
    state = reduced.state;
  }
});
