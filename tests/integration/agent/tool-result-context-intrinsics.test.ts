import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createToolResultContext } from "#veryfront/agent/runtime/tool-result-context.ts";
import { readToolResultContext } from "#veryfront/agent/runtime/tool-result-context-tools.ts";

describe("tool result context intrinsics", () => {
  it("preserves structure entries without invoking inherited array setters", () => {
    const context = createToolResultContext({ limits: { maxInlineBytes: 4 } });
    const disclosed = context.disclose({
      toolCallId: "setter",
      toolName: "read",
      result: { padding: "oversize", count: 2 },
    });
    if (disclosed.kind !== "reference") throw new Error("Expected retained result");
    let calls = 0;
    let text = "";
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          calls++;
        },
      });
      text =
        readToolResultContext(context, { ref: disclosed.modelResult.ref, view: "structure" }).text;
    } finally {
      if (original) Object.defineProperty(Array.prototype, "0", original);
      else Reflect.deleteProperty(Array.prototype, "0");
    }
    assertEquals(calls, 0);
    assertEquals(JSON.parse(text).fields.length, 2);
  });
});
