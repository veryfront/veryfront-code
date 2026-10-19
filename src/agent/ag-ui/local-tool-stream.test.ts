import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ConversationRunEventEncoder } from "../conversation/run-events.ts";
import { createAgUiEncoderState, mapRuntimeStreamEventToAgUiEvents } from "./encoder.ts";
import { coerceWireEvent } from "./sse-parser.ts";
import { createLocalToolStream } from "./local-tool-stream.ts";

const start = { type: "TOOL_CALL_START", toolCallId: "call", toolCallName: "search" };
const args = { type: "TOOL_CALL_ARGS", toolCallId: "call", delta: "{}" };
const end = { type: "TOOL_CALL_END", toolCallId: "call" };

describe("local durable tool stream", () => {
  for (const ordering of ["before", "after"]) {
    it(`keeps one start and empty input when the stream arrives ${ordering} admission`, () => {
      const stream = createLocalToolStream();
      const persisted = [];
      if (ordering === "before") persisted.push(...stream.encode([start, args, end]));
      assertEquals(persisted, []);
      // Only the execution writer's successful admission can open the durable call.
      persisted.push(start, ...stream.admit("call"));
      if (ordering === "after") persisted.push(...stream.encode([start, args, end]));
      persisted.push(...stream.finish());
      assertEquals(persisted, [start, args, end]);
    });
  }
  it("retains a stream-only tool timeline without treating it as admitted", () => {
    const stream = createLocalToolStream();
    assertEquals(stream.encode([start, args, end]), []);
    assertEquals(stream.finish(), [start, args, end]);
  });
});

for (const path of ["root", "inherited"]) {
  for (const ordering of ["before", "after"]) {
    it(`${path} encoder preserves one empty input when stream starts ${ordering} admission`, () => {
      const state = createAgUiEncoderState();
      const encoder = new ConversationRunEventEncoder();
      const stream = createLocalToolStream();
      const persisted: { type: string; toolCallId?: unknown }[] = [];
      const encode = (event: Parameters<typeof mapRuntimeStreamEventToAgUiEvents>[1]) => {
        const events = path === "root"
          ? encoder.encode(event as Parameters<typeof encoder.encode>[0])
          : mapRuntimeStreamEventToAgUiEvents(state, event).map(({ event, payload }) =>
            coerceWireEvent(event, payload)
          );
        persisted.push(...stream.encode(events as (typeof start)[]));
      };
      if (ordering === "before") {
        encode({ type: "tool-input-start", toolCallId: "call", toolName: "search" });
        encode({ type: "tool-input-available", toolCallId: "call", input: {} });
      }
      assertEquals(persisted, []);
      persisted.push(start, ...stream.admit("call"));
      if (ordering === "after") {
        encode({ type: "tool-input-start", toolCallId: "call", toolName: "search" });
        encode({ type: "tool-input-available", toolCallId: "call", input: {} });
      }
      assertEquals(persisted.filter((event) => event.type === "TOOL_CALL_START"), [start]);
      assertEquals(
        persisted.filter((event) => event.type === "TOOL_CALL_ARGS").map((event) =>
          "delta" in event ? event.delta : undefined
        ),
        ["{}"],
      );
      assertEquals(persisted.map((event) => event.type), [
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
      ]);
    });
  }
}
