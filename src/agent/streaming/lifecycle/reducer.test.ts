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

  it("records reducer-approved tool progress in the canonical snapshot", () => {
    let state = createInitialReducerState();
    state = reduceStreamSignal(
      state,
      protocol({
        type: "tool_input_start",
        toolCallId: "t1",
        toolName: "create_file",
      }),
      1,
    ).state;
    const reduced = reduceStreamSignal(
      state,
      protocol({
        type: "tool_input_content",
        toolCallId: "t1",
        delta: '{"path":"a.md"}',
      }),
      2,
    );

    assertEquals(reduced.semanticProgress, true);
    assertEquals(reduced.state.snapshot.hasSemanticProgress, true);
    assertEquals(reduced.state.snapshot.phase, "awaiting_tool_input");
  });

  it("keeps parallel tool inputs independent and hands off only valid local calls", () => {
    let state = createInitialReducerState();
    for (
      const event of [
        { type: "tool_input_start", toolCallId: "a", toolName: "create_file" },
        { type: "tool_input_start", toolCallId: "b", toolName: "create_file" },
        {
          type: "tool_input_content",
          toolCallId: "a",
          delta: '{"path":"a.md"}',
        },
        { type: "tool_input_content", toolCallId: "b", delta: '{"path":' },
        { type: "step_finish", finishReason: "tool-calls" },
      ] as const
    ) {
      state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
    }

    assertEquals(state.snapshot.phase, "tool_handoff");
    assertEquals(state.snapshot.tools.map((tool) => [tool.id, tool.phase]), [
      ["a", "input_ready"],
      ["b", "input_rejected"],
    ]);
  });

  it("rejects unavailable local input without handing it to execution", () => {
    let state = createInitialReducerState();
    state = reduceStreamSignal(state, {
      kind: "protocol",
      event: {
        type: "tool_input_rejected",
        toolCallId: "missing",
        toolName: "missing_tool",
        reason: "unavailable",
      },
    }, 1).state;
    state = reduceStreamSignal(state, {
      kind: "protocol",
      event: { type: "step_finish", finishReason: "tool-calls" },
    }, 2).state;

    assertEquals(state.snapshot.phase, "failed");
    assertEquals(state.snapshot.tools[0]?.phase, "input_rejected");
  });

  it("accepts provider tool output only for explicitly provider-executed input", () => {
    const state = createInitialReducerState();
    const resultWithoutInput = reduceStreamSignal(state, {
      kind: "protocol",
      event: {
        type: "provider_tool_result",
        toolCallId: "native-1",
        toolName: "web_search",
        output: "ok",
        isError: false,
        providerExecuted: true,
      },
    }, 1);
    assertEquals(resultWithoutInput.state.snapshot.phase, "failed");
  });

  it("requires the provider tool running transition before a terminal result", () => {
    let state = createInitialReducerState();
    for (
      const event of [
        {
          type: "tool_input_start",
          toolCallId: "native-1",
          toolName: "web_search",
          providerExecuted: true,
        },
        {
          type: "tool_input_ready",
          toolCallId: "native-1",
          toolName: "web_search",
          input: {},
          providerExecuted: true,
        },
        {
          type: "provider_tool_start",
          toolCallId: "native-1",
          toolName: "web_search",
          providerExecuted: true,
        },
        {
          type: "provider_tool_result",
          toolCallId: "native-1",
          toolName: "web_search",
          output: "ok",
          isError: false,
          providerExecuted: true,
        },
      ] as const
    ) {
      state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
    }
    assertEquals(state.snapshot.tools[0]?.phase, "succeeded");
  });

  it("uses running as the only entry to every provider tool terminal state", () => {
    const terminals = [
      {
        event: { type: "provider_tool_result", output: "ok", isError: false },
        expected: "succeeded",
      },
      {
        event: {
          type: "provider_tool_result",
          output: "failed",
          isError: true,
        },
        expected: "failed",
      },
      { event: { type: "provider_tool_denied" }, expected: "denied" },
      { event: { type: "provider_tool_cancelled" }, expected: "cancelled" },
    ] as const;

    for (const terminal of terminals) {
      let state = createInitialReducerState();
      for (
        const event of [
          {
            type: "tool_input_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "native-1",
            toolName: "web_search",
            input: {},
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            ...terminal.event,
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        ] as const
      ) {
        state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
      }
      assertEquals(state.snapshot.tools[0]?.phase, terminal.expected);

      let invalid = createInitialReducerState();
      for (
        const event of [
          {
            type: "tool_input_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "native-1",
            toolName: "web_search",
            input: {},
            providerExecuted: true,
          },
          {
            ...terminal.event,
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        ] as const
      ) {
        invalid = reduceStreamSignal(invalid, { kind: "protocol", event }, 1).state;
      }
      assertEquals(invalid.snapshot.phase, "failed");
    }
  });
});
