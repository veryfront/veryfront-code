import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { collectFinalStreamToolResults } from "#veryfront/agent/runtime/tool-result-continuation.ts";

describe("private completed stream results", () => {
  for (const method of [Symbol.iterator, "filter", "map", "some"] as const) {
    it(`does not expose result collections through ${String(method)}`, async () => {
      const marker = "synthetic-private-provider-result";
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "synthetic-call",
          toolName: "inspect",
          input: {},
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "synthetic-call",
          toolName: "inspect",
          output: { text: marker },
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "synthetic-call",
          toolName: "inspect",
          output: { text: marker },
          providerExecuted: true,
        },
        {
          type: "tool-call",
          toolCallId: "pending-call",
          toolName: "inspect",
          input: {},
          providerExecuted: true,
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, method)!;
      const apply = Reflect.apply;
      let observations = 0;
      let collected;
      try {
        Object.defineProperty(Array.prototype, method, {
          ...descriptor,
          value: function (this: unknown[], ...args: unknown[]) {
            if (
              this.length > 0 && state.toolResults.length > 0 && this[0] === state.toolResults[0]
            ) observations++;
            return apply(descriptor.value, this, args);
          },
        });
        await processStream(result, state, controller, encoder, "synthetic-text", undefined);
        collected = collectFinalStreamToolResults(state);
      } finally {
        Object.defineProperty(Array.prototype, method, descriptor);
      }
      assertEquals(collected.get("synthetic-call")?.output, { text: marker });
      assertEquals(observations, 0);
    });
  }
});
