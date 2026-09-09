import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  stripLeadingEmptyObjectPlaceholder,
} from "#veryfront/agent/streaming/tool-input.ts";
import { parseToolArgs } from "#veryfront/agent/runtime/tool-helpers.ts";

describe("private streamed tool input normalization", () => {
  for (const method of ["trim", "trimStart", "startsWith", "endsWith", "slice"] as const) {
    it(`does not expose arguments through replaced ${method}`, () => {
      const marker = "synthetic-private-stream-input";
      const payload = JSON.stringify({ text: marker });
      const original = String.prototype[method];
      const apply = Reflect.apply;
      const includes = String.prototype.includes;
      let observations = 0;
      let normalized, parsed, merged, complete;
      try {
        Object.defineProperty(String.prototype, method, {
          configurable: true,
          writable: true,
          value: function (this: string, ...args: unknown[]) {
            if (apply(includes, this, [marker])) observations++;
            return apply(original, this, args);
          },
        });
        normalized = stripLeadingEmptyObjectPlaceholder(` {}  ${payload} `);
        parsed = parseToolArgs(` {} ${payload}`);
        merged = mergeToolInputDelta(payload, "-suffix");
        complete = mergeToolCallInput(payload, "{}");
      } finally {
        Object.defineProperty(String.prototype, method, {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      assertEquals(normalized, payload);
      assertEquals(parsed?.args, { text: marker });
      assertEquals(merged, payload + "-suffix");
      assertEquals(complete, payload);
      assertEquals(observations, 0);
    });
  }
});
