import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialReducerState, reduceStreamSignal } from "./reducer.ts";
import type { StreamProtocolEvent } from "./types.ts";

const protocol = (event: StreamProtocolEvent) => ({
  kind: "protocol" as const,
  event,
});

describe("stream lifecycle reducer", () => {
  it("balances reasoning before text and creates a new text identity after end", () => {
    let state = createInitialReducerState();
    const events = [
      { type: "reasoning_start", id: "r1" },
      { type: "reasoning_content", id: "r1", delta: "thinking" },
      { type: "text_content", id: "provider-text", delta: "first" },
      { type: "text_end", id: "provider-text" },
      { type: "text_content", id: "provider-text", delta: "second" },
    ] as const;
    const frames = events.flatMap((event, index) => {
      const reduced = reduceStreamSignal(state, protocol(event), index + 1);
      state = reduced.state;
      return reduced.frames;
    });

    assertEquals(
      frames.filter((frame) => frame.class === "semantic").map((frame) => frame.event.type),
      [
        "reasoning_start",
        "reasoning_content",
        "reasoning_end",
        "text_start",
        "text_content",
        "text_end",
        "text_start",
        "text_content",
      ],
    );
    assertEquals(state.snapshot.accumulatedText, "firstsecond");
  });

  it("does not count empty content, status, or metadata as semantic progress", () => {
    let state = createInitialReducerState();
    for (
      const event of [
        { type: "text_content", delta: "" },
        {
          type: "custom",
          name: "tool-call-status",
          data: { status: "pending_input" },
        },
      ] as const
    ) {
      const reduced = reduceStreamSignal(state, protocol(event), 1);
      state = reduced.state;
      assertEquals(reduced.semanticProgress, false);
    }
  });
});
