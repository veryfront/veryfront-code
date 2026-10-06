import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiRuntimeEventEncoder } from "./runtime-event-encoder.ts";

describe("AG-UI manual pause", () => {
  for (const visible of [false, true]) {
    it(`keeps a paused stream nonterminal with visible output ${visible}`, () => {
      const encoder = createAgUiRuntimeEventEncoder();
      if (visible) {
        encoder.encode({ type: "message-start", messageId: "message-1" });
        encoder.encode({ type: "text-delta", id: "text-1", delta: "Working" });
      }
      encoder.encode({ type: "data-veryfront.manual_pause", data: {} });
      assertEquals(
        encoder.finalize(null).some((event) =>
          event.event === "RunFinished" || event.event === "RunError"
        ),
        false,
      );
    });
  }
});
