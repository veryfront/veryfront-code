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
  it("keeps admission ordering when mutable collection intrinsics are replaced", () => {
    const stream = createLocalToolStream();
    const startsWith = String.prototype.startsWith;
    const has = Set.prototype.has;
    const add = Set.prototype.add;
    const push = Array.prototype.push;
    const splice = Array.prototype.splice;
    let before: typeof start[] = [];
    let admitted: typeof start[] = [];
    let finished: typeof start[] = [];
    try {
      String.prototype.startsWith = () => false;
      Set.prototype.has = () => true;
      Set.prototype.add = function () {
        return this;
      };
      Array.prototype.push = function () {
        return this.length;
      };
      Array.prototype.splice = function () {
        return [];
      };
      before = stream.encode([start, args, end]) as typeof start[];
      admitted = stream.admit("call") as typeof start[];
      finished = stream.finish() as typeof start[];
    } finally {
      String.prototype.startsWith = startsWith;
      Set.prototype.has = has;
      Set.prototype.add = add;
      Array.prototype.push = push;
      Array.prototype.splice = splice;
    }
    assertEquals(before, []);
    assertEquals(admitted, [args, end]);
    assertEquals(finished, []);
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

for (const execution of [true, false]) {
  it(`preserves interleaved stream order for ${execution ? "admitted" : "stream-only"} tools`, () => {
    const stream = createLocalToolStream();
    const before = { type: "TEXT_MESSAGE_START" };
    const following = [
      { type: "CUSTOM", name: "usage" },
      { type: "TEXT_MESSAGE_START" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "done" },
      { type: "TEXT_MESSAGE_END" },
      { type: "STEP_FINISHED" },
    ];
    const persisted = [...stream.encode([before, start, args])];
    persisted.push(...stream.encode([end, ...following]));
    assertEquals(persisted, [before]);
    if (execution) persisted.push(start, ...stream.admit("call"));
    persisted.push(...stream.finish());
    assertEquals(persisted, [before, start, args, end, ...following]);
  });
}

it("holds later admitted tool input behind an earlier pending stream call", () => {
  const stream = createLocalToolStream();
  const otherStart = { ...start, toolCallId: "other" };
  const otherArgs = { ...args, toolCallId: "other" };
  const custom = { type: "CUSTOM" };
  assertEquals(stream.encode([start, args, otherStart, otherArgs, custom, end]), []);
  assertEquals(stream.admit("other"), []);
  // The later call's receipt already persisted its own start; queued stream data
  // still retains its order behind the earlier call.
  assertEquals(stream.finish(), [start, args, otherArgs, custom, end]);
});
