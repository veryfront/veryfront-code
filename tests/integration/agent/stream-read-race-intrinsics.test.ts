import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";

for (const hooks of [false, true]) {
  describe(`private stream read race ${hooks ? "hooks" : "baseline"}`, () => {
    it("reads provider parts without exposing their promises to Promise.race", async () => {
      const marker = "synthetic-private-timed-read";
      const state = createStreamState();
      const { controller, encoder } = createSSECollector();
      const result = createMockResult([
        { type: "text-delta", text: marker },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);
      const NativePromise = Promise;
      const race = Promise.race;
      const then = Promise.prototype.then;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      try {
        if (hooks) {
          Promise.race = ((values: Iterable<unknown>) => {
            for (const value of values) {
              apply(then, value, [(part: unknown) => {
                if (apply(includes, stringify(part) ?? "", [marker])) observations++;
              }, () => undefined]);
            }
            return apply(race, NativePromise, [values]);
          }) as typeof race;
        }
        await processStream(result, state, controller, encoder, "text", {
          streamIdleTimeoutMs: 1_000,
        });
      } finally {
        if (hooks) Promise.race = race;
      }
      assertEquals(state.accumulatedText, marker);
      assertEquals(state.finishReason, "stop");
      assertEquals(observations, 0);
    });
  });
}
