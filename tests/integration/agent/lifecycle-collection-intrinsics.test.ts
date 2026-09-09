import "#veryfront/schemas/_test-setup.ts";
import { createStreamLifecycleLiveAdapter } from "#veryfront/agent/streaming/lifecycle/live-adapter.ts";
import {
  createInitialReducerState,
  finalizeStreamProjection,
  reduceStreamSignal,
  resolveLocalToolDeadline,
} from "#veryfront/agent/streaming/lifecycle/reducer.ts";
import type {
  StreamLifecycleFrame,
  StreamProtocolEvent,
} from "#veryfront/agent/streaming/lifecycle/types.ts";
import type { ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// Shared-intrinsic variants run in CI. Local runs must explicitly filter to baseline.
for (
  const probe of ["baseline", "array methods", "array iterator", "map methods", "map constructor"]
) {
  describe(`private lifecycle collections ${probe}`, () => {
    it("retains reasoning, ordered tool deltas, and deadline frames without collection hooks", () => {
      const marker = "synthetic-private-lifecycle-content";
      const input = { text: marker };
      const events: StreamProtocolEvent[] = [
        { type: "reasoning_content", id: "r1", delta: marker },
        { type: "reasoning_content", id: "r1", delta: "!" },
        { type: "reasoning_end", id: "r1", signature: marker },
        { type: "text_content", delta: marker },
        { type: "tool_input_start", toolCallId: "b", toolName: "inspect" },
        { type: "tool_input_content", toolCallId: "b", delta: '{"text":' },
        { type: "tool_input_content", toolCallId: "b", delta: `"${marker}"}` },
        { type: "tool_input_start", toolCallId: "a", toolName: "inspect" },
        { type: "tool_input_content", toolCallId: "a", delta: '{"text":' },
      ];
      const NativeMap = Map;
      const arrayIterator = Array.prototype[Symbol.iterator];
      const methodNames = ["push", "map", "filter", "some", "findIndex"] as const;
      const arrayMethods = methodNames.map((name) => Array.prototype[name]);
      const mapNames = ["get", "set", "delete", "values", "entries"] as const;
      const mapMethods = mapNames.map((name) => Map.prototype[name]);
      const mapIterator = Map.prototype[Symbol.iterator];
      const apply = Reflect.apply;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const observe = (value: unknown) => {
        if (apply(includes, stringify(value) ?? "", [marker])) observations++;
      };
      let observations = 0;
      let state = createInitialReducerState();
      let finished: typeof state | undefined;
      let projected: StreamLifecycleFrame[] = [];
      let emitted: ChatStreamEvent[] = [];
      let deadline: ReturnType<typeof resolveLocalToolDeadline> | undefined;
      let failed: ReturnType<typeof resolveLocalToolDeadline> | undefined;
      try {
        if (probe === "array methods") {
          for (let index = 0; index < methodNames.length; index++) {
            const name = methodNames[index]!;
            const original = arrayMethods[index]!;
            Object.defineProperty(Array.prototype, name, {
              configurable: true,
              writable: true,
              value: function (this: unknown[], ...args: unknown[]) {
                observe(this);
                observe(args);
                return apply(original, this, args);
              },
            });
          }
        }
        if (probe === "array iterator") {
          Array.prototype[Symbol.iterator] = function () {
            observe(this);
            return apply(arrayIterator, this, []);
          };
        }
        if (probe === "map methods") {
          for (let index = 0; index < mapNames.length; index++) {
            const name = mapNames[index]!;
            const original = mapMethods[index]!;
            Object.defineProperty(Map.prototype, name, {
              configurable: true,
              writable: true,
              value: function (this: Map<unknown, unknown>, ...args: unknown[]) {
                observations++;
                return apply(original, this, args);
              },
            });
          }
          Map.prototype[Symbol.iterator] = function () {
            observations++;
            return apply(mapIterator, this, []);
          };
        }
        if (probe === "map constructor") {
          globalThis.Map = new Proxy(NativeMap, {
            construct(target, args, newTarget) {
              observations++;
              return Reflect.construct(target, args, newTarget);
            },
          });
        }
        state = createInitialReducerState();
        const adapter = createStreamLifecycleLiveAdapter({});
        for (let index = 0; index < events.length; index++) {
          const reduction = reduceStreamSignal(
            state,
            { kind: "protocol", event: events[index]! },
            index,
          );
          state = reduction.state;
          for (let frame = 0; frame < reduction.frames.length; frame++) {
            adapter.encode(reduction.frames[frame]!);
          }
        }
        deadline = resolveLocalToolDeadline(state, "tool_input_idle", 10);
        for (let index = 0; index < deadline.reduction.frames.length; index++) {
          const encoded = adapter.encode(deadline.reduction.frames[index]!);
          if (encoded[0]?.type === "tool-input-start") emitted = encoded;
        }
        finished = reduceStreamSignal(state, {
          kind: "protocol",
          event: { type: "step_finish", finishReason: "tool-calls" },
        }, 11).state;
        const text = reduceStreamSignal(createInitialReducerState(), {
          kind: "protocol",
          event: { type: "text_content", delta: marker },
        }, 12);
        projected = finalizeStreamProjection(text.state, 13).frames;
        const incomplete = reduceStreamSignal(createInitialReducerState(), {
          kind: "protocol",
          event: { type: "tool_input_start", toolCallId: "empty", toolName: "inspect" },
        }, 14);
        failed = resolveLocalToolDeadline(incomplete.state, "tool_commit_grace", 15);
      } finally {
        if (probe === "array methods") {
          for (let index = 0; index < methodNames.length; index++) {
            Object.defineProperty(Array.prototype, methodNames[index]!, {
              configurable: true,
              writable: true,
              value: arrayMethods[index],
            });
          }
        }
        if (probe === "array iterator") Array.prototype[Symbol.iterator] = arrayIterator;
        if (probe === "map methods") {
          for (let index = 0; index < mapNames.length; index++) {
            Object.defineProperty(Map.prototype, mapNames[index]!, {
              configurable: true,
              writable: true,
              value: mapMethods[index],
            });
          }
          Map.prototype[Symbol.iterator] = mapIterator;
        }
        if (probe === "map constructor") globalThis.Map = NativeMap;
      }
      assertEquals(observations, 0);
      assertEquals(state.snapshot.reasoning, [{ id: "r1", text: `${marker}!`, signature: marker }]);
      assertEquals(state.snapshot.accumulatedText, marker);
      assertEquals(deadline?.kind, "handoff");
      assertEquals(deadline?.reduction.state.snapshot.tools.map((tool) => [tool.id, tool.phase]), [
        ["b", "input_ready"],
        ["a", "input_rejected"],
      ]);
      assertEquals(deadline?.reduction.state.snapshot.tools[0]?.input, input);
      assertEquals(finished?.snapshot.phase, "tool_handoff");
      assertEquals(emitted, [
        { type: "tool-input-start", toolCallId: "b", toolName: "inspect" },
        { type: "tool-input-delta", toolCallId: "b", inputTextDelta: '{"text":' },
        { type: "tool-input-delta", toolCallId: "b", inputTextDelta: `"${marker}"}` },
        { type: "tool-input-available", toolCallId: "b", toolName: "inspect", input },
      ]);
      assertEquals(projected.map((frame) => frame.event.type), ["text_end"]);
      assertEquals(failed?.kind, "failed");
      assertEquals(failed?.kind === "failed" ? failed.code : null, "TOOL_INPUT_TIMEOUT");
    });
  });
}
