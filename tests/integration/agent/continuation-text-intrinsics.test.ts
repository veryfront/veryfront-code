import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  materializeStreamedToolCall,
  shouldContinueAfterStreamStep,
} from "#veryfront/agent/runtime/tool-result-continuation.ts";

describe("private continuation text", () => {
  for (const method of ["trim", "slice"] as const) {
    it(`keeps accumulated output and incomplete arguments out of replaced ${method}`, () => {
      const marker = "synthetic-private-continuation";
      const original = String.prototype[method];
      const apply = Reflect.apply;
      const includes = String.prototype.includes;
      let observations = 0;
      let continues;
      let materialized;
      try {
        Object.defineProperty(String.prototype, method, {
          configurable: true,
          writable: true,
          value: function (this: string, ...args: unknown[]) {
            if (apply(includes, this, [marker])) observations++;
            return apply(original, this, args);
          },
        });
        continues = shouldContinueAfterStreamStep({
          accumulatedText: ` ${marker} `,
          finishReason: "stop",
          toolCalls: new Map(),
          toolResults: [],
        });
        materialized = materializeStreamedToolCall({
          id: "synthetic-call",
          name: "inspect",
          arguments: marker,
          inputAvailable: false,
        });
      } finally {
        Object.defineProperty(String.prototype, method, {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      assertEquals(continues, false);
      assertEquals(materialized?.kind, "incomplete");
      if (materialized?.kind === "incomplete") {
        assertEquals(materialized.partialArgumentsPreview, marker);
      }
      assertEquals(observations, 0);
    });
  }
});
