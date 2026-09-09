import "#veryfront/schemas/_test-setup.ts";
import {
  createRuntimeStreamSource,
  createStreamState,
  processStream,
} from "#veryfront/agent/runtime/chat-stream-handler.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private lifecycle signal iteration ${hooks ? "hooks" : "baseline"}`, () => {
    for (const mode of ["shadow", "active"] as const) {
      it(`preserves private provider output in ${mode} without shared signal or frame iteration`, async () => {
        const marker = "synthetic-private-lifecycle-signal";
        const result = createMockResult([
          { type: "reasoning-start", id: "reasoning" },
          { type: "reasoning-delta", id: "reasoning", delta: marker },
          { type: "reasoning-end", id: "reasoning" },
          { type: "text-delta", text: marker },
          { type: "finish", finishReason: "stop", totalUsage: null },
        ]);
        const state = createStreamState();
        const { controller, encoder } = createSSECollector();
        const iterator = Array.prototype[Symbol.iterator];
        const stringify = JSON.stringify;
        const includes = String.prototype.includes;
        const apply = Reflect.apply;
        let observations = 0;
        try {
          if (hooks) {
            Array.prototype[Symbol.iterator] = function () {
              for (let index = 0; index < this.length; index++) {
                const value = this[index];
                if (
                  value && typeof value === "object" &&
                  (value.kind === "protocol" || value.class === "semantic") &&
                  apply(includes, stringify(value), [marker])
                ) observations++;
              }
              return apply(iterator, this, []);
            };
          }
          await processStream(
            mode === "active" ? createRuntimeStreamSource(() => result) : result,
            state,
            controller,
            encoder,
            "text",
            {
              streamLifecycleMode: mode,
            },
          );
        } finally {
          if (hooks) Array.prototype[Symbol.iterator] = iterator;
        }
        assertEquals(state.accumulatedText, marker);
        assertEquals(state.reasoningParts[0]?.text, marker);
        assertEquals(state.finishReason, "stop");
        assertEquals(observations, 0);
      });
    }
  });
}
