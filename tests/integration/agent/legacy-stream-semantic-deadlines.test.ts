import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { createSSECollector } from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { ManualMonotonicClock } from "#veryfront/agent/streaming/lifecycle/index.ts";

function emptyAsyncIterable(): AsyncIterable<string> {
  return { async *[Symbol.asyncIterator]() {} };
}

describe("legacy model stream semantic deadlines", () => {
  for (const hasOutput of [false, true]) {
    it(`preserves the ${hasOutput ? "semantic-idle" : "first-progress"} deadline across metadata`, async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      if (hasOutput) state.accumulatedText = "Ready.";
      const clock = new ManualMonotonicClock();
      const budgets: number[] = [];
      let reads = 0;
      const fullStream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (reads++ === 0) {
                clock.advanceBy(8);
                return Promise.resolve({
                  done: false as const,
                  value: { type: "reasoning-start", id: "empty" },
                });
              }
              return new Promise<IteratorResult<unknown>>(() => {});
            },
            return() {
              return Promise.resolve({ done: true as const, value: undefined });
            },
          };
        },
      };
      const timer = Object.assign((callback: TimerHandler, delay?: number) => {
        budgets.push(delay ?? 0);
        if (budgets.length === 2 && typeof callback === "function") {
          queueMicrotask(() => callback());
        }
        return globalThis.setTimeout(() => {}, 60_000);
      }, globalThis.setTimeout);
      const outcome = processStream(
        { fullStream, textStream: emptyAsyncIterable() },
        state,
        controller,
        encoder,
        "t",
        {
          streamLifecyclePolicy: { clock, firstProgressTimeoutMs: 10, semanticIdleTimeoutMs: 10 },
          setTimeoutFn: timer,
        },
      );
      if (hasOutput) await outcome;
      else await assertRejects(() => outcome, Error, "Provider stream failed");
      assertEquals(budgets, [10, 2]);
    });
  }
});
