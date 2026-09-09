import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message } from "#veryfront/agent/types.ts";
import {
  convertToTextGenerationRuntimeMessages,
  convertToTextGenerationRuntimeRequestMessages,
} from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";

for (const replaceMethods of [false, true]) {
  describe(`private provider conversion ${replaceMethods ? "hooks" : "baseline"}`, () => {
    it("preserves prompt, assistant, and tool segments without observable lookups", () => {
      const prompt = "synthetic-private-conversion-prompt";
      const modelText = "synthetic-private-conversion-output";
      const argumentsValue = "synthetic-private-conversion-arguments";
      const resultValue = "synthetic-private-conversion-result";
      const messages: Message[] = [
        { id: "user", role: "user", parts: [{ type: "text", text: prompt }] },
        {
          id: "assistant",
          role: "assistant",
          parts: [
            { type: "text", text: modelText },
            {
              type: "tool-call",
              toolCallId: "call",
              toolName: "local_tool",
              input: { query: argumentsValue },
            },
            {
              type: "tool-result",
              toolCallId: "call",
              toolName: "local_tool",
              result: resultValue,
            },
            { type: "text", text: "Complete" },
          ],
        },
      ];
      const includes = String.prototype.includes;
      const iterate = Array.prototype[Symbol.iterator];
      const apply = Reflect.apply;
      let textObservations = 0;
      let arrayObservations = 0;
      let converted: ReturnType<typeof convertToTextGenerationRuntimeMessages> = [];
      try {
        if (replaceMethods) {
          String.prototype.includes = function (search, position) {
            if (this === prompt) textObservations++;
            return apply(includes, this, [search, position]);
          };
          Array.prototype[Symbol.iterator] = function () {
            for (let index = 0; index < this.length; index++) {
              const part = this[index];
              if (
                part && typeof part === "object" && (
                  part.text === prompt || part.text === modelText ||
                  part.input?.query === argumentsValue || part.output?.value === resultValue
                )
              ) arrayObservations++;
            }
            return apply(iterate, this, []);
          };
        }
        converted = convertToTextGenerationRuntimeMessages(messages);
      } finally {
        if (replaceMethods) {
          String.prototype.includes = includes;
          Array.prototype[Symbol.iterator] = iterate;
        }
      }
      assertEquals(converted, [
        { role: "user", content: prompt },
        {
          role: "assistant",
          content: [
            { type: "text", text: modelText },
            {
              type: "tool-call",
              toolCallId: "call",
              toolName: "local_tool",
              input: { query: argumentsValue },
            },
          ],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "call",
            toolName: "local_tool",
            output: { type: "json", value: resultValue },
          }],
        },
        { role: "assistant", content: [{ type: "text", text: "Complete" }] },
      ]);
      assertEquals(textObservations, 0);
      assertEquals(arrayObservations, 0);
    });
  });
}

describe("private provider request tails", () => {
  for (const method of ["at", "pop"] as const) {
    it(`trims trailing assistant messages without observable ${method} calls`, () => {
      const marker = "synthetic-private-provider-tail";
      const messages: Message[] = [
        { id: "user", role: "user", parts: [{ type: "text", text: marker }] },
        { id: "assistant", role: "assistant", parts: [{ type: "text", text: marker }] },
      ];
      const expected = convertToTextGenerationRuntimeRequestMessages(messages);
      const original = Array.prototype[method];
      let exposures = 0;
      let actual: typeof expected = [];
      Object.defineProperty(Array.prototype, method, {
        configurable: true,
        writable: true,
        value: function (this: unknown[], ...args: unknown[]) {
          if (JSON.stringify(this).includes(marker)) exposures++;
          return Reflect.apply(original, this, args);
        },
      });
      try {
        actual = convertToTextGenerationRuntimeRequestMessages(messages);
      } finally {
        Object.defineProperty(Array.prototype, method, {
          configurable: true,
          writable: true,
          value: original,
        });
      }
      assertEquals(actual, expected);
      assertEquals(actual, [{ role: "user", content: marker }]);
      assertEquals(exposures, 0);
    });
  }
});
