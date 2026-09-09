import type { StreamingToolCall } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { shouldContinueAfterStreamStep } from "#veryfront/agent/runtime/tool-result-continuation.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private map entry ${hooks ? "hooks" : "baseline"}`, () => {
    it("continues after completed provider results without exposing tool-call entries", () => {
      const marker = "synthetic-private-provider-arguments";
      const toolCalls = createPrivateMap<string, StreamingToolCall>();
      toolCalls.set("call", {
        id: "call",
        name: "inspect",
        arguments: JSON.stringify({ text: marker }),
        inputAvailable: true,
        providerExecuted: true,
      });
      const state = {
        accumulatedText: "",
        finishReason: "stop",
        toolCalls,
        toolResults: [{
          toolCallId: "call",
          toolName: "inspect",
          output: { ok: true },
          providerExecuted: true,
        }],
      };
      const iterator = Array.prototype[Symbol.iterator];
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let continued = false;
      try {
        if (hooks) {
          Array.prototype[Symbol.iterator] = function () {
            if (
              this[0] === "call" && typeof this[1]?.arguments === "string" &&
              apply(includes, this[1].arguments, [marker])
            ) observations++;
            return apply(iterator, this, []);
          };
        }
        continued = shouldContinueAfterStreamStep(state);
      } finally {
        if (hooks) Array.prototype[Symbol.iterator] = iterator;
      }
      assertEquals(continued, true);
      assertEquals(observations, 0);
    });
  });
}
