import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTextFromParts, type MessagePart } from "#veryfront/agent/types.ts";
import {
  estimateTokens,
  getTextFromMemoryParts,
  type MinimalMessage,
} from "#veryfront/agent/memory/memory-interface.ts";

describe("private message text extraction", () => {
  it("concatenates only text parts without consulting array methods", () => {
    const parts: MessagePart[] = [
      { type: "text", text: "Synthetic " },
      {
        type: "tool-result",
        toolCallId: "ignored",
        toolName: "ignored",
        result: { text: "Not prompt text" },
      },
      { type: "text", text: "å🙂" },
    ];
    let reads = 0;
    Object.defineProperty(parts, "filter", {
      get() {
        reads++;
        return Array.prototype.filter;
      },
    });
    assertEquals(getTextFromParts(parts), "Synthetic å🙂");
    assertEquals(getTextFromMemoryParts(parts), "Synthetic å🙂");
    assertEquals(reads, 0);
  });

  it("ignores inherited parts and estimates tokens without a mutable reducer", () => {
    const parts: MessagePart[] = [{ type: "text", text: "Owned" }];
    parts.length = 2;
    let reads = 0;
    Object.setPrototypeOf(
      parts,
      Object.create(Array.prototype, {
        1: {
          get() {
            reads++;
            return { type: "text", text: "Injected" };
          },
        },
      }),
    );
    const messages: MinimalMessage[] = [{ id: "synthetic", role: "user", parts }];
    Object.defineProperty(messages, "reduce", {
      get() {
        reads++;
        return Array.prototype.reduce;
      },
    });
    assertEquals(getTextFromParts(parts), "Owned");
    assertEquals(estimateTokens(messages), 2);
    assertEquals(reads, 0);
  });
});
