import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";

describe("private stream maps", () => {
  for (const probe of ["construction", "operations"]) {
    it(`keeps accumulated model arguments out of replaced Map ${probe}`, async () => {
      const marker = "synthetic-private-tool-arguments";
      const { controller, encoder } = createSSECollector();
      const result = createMockResult([
        { type: "tool-input-start", id: "synthetic-call", toolName: "inspect" },
        { type: "tool-input-delta", id: "synthetic-call", delta: JSON.stringify({ text: marker }) },
        { type: "tool-input-end", id: "synthetic-call" },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);
      const NativeMap = Map;
      const nativeSet = Map.prototype.set;
      const nativeGet = Map.prototype.get;
      const retained: Map<unknown, unknown>[] = [];
      let state: ReturnType<typeof createStreamState>;
      try {
        if (probe === "construction") {
          globalThis.Map = class<K, V> extends NativeMap<K, V> {
            constructor(entries?: Iterable<readonly [K, V]> | null) {
              super(entries);
              retained.push(this);
            }
          };
        } else {
          Map.prototype.set = function (key, value) {
            retained.push(this);
            return Reflect.apply(nativeSet, this, [key, value]);
          };
          Map.prototype.get = function (key) {
            retained.push(this);
            return Reflect.apply(nativeGet, this, [key]);
          };
        }
        state = createStreamState();
        await processStream(result, state, controller, encoder, "synthetic-text", undefined);
      } finally {
        globalThis.Map = NativeMap;
        Map.prototype.set = nativeSet;
        Map.prototype.get = nativeGet;
      }
      assertEquals(
        state.toolCalls.get("synthetic-call")?.arguments,
        JSON.stringify({ text: marker }),
      );
      let exposures = 0;
      for (const map of retained) {
        for (const value of map.values()) {
          if (JSON.stringify(value)?.includes(marker)) exposures++;
        }
      }
      assertEquals(exposures, 0);
    });
  }
});
