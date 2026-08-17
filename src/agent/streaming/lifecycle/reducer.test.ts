import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectCommittedLocalToolCalls } from "../stream-outcome.ts";
import { createInitialReducerState, reduceStreamSignal } from "./reducer.ts";
import type { StreamProtocolEvent } from "./types.ts";

const protocol = (event: StreamProtocolEvent) => ({
  kind: "protocol" as const,
  event,
});

function reduceEvents(events: readonly StreamProtocolEvent[]) {
  let state = createInitialReducerState();
  for (const [index, event] of events.entries()) {
    state = reduceStreamSignal(state, protocol(event), index + 1).state;
  }
  return state;
}

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

  it("keeps bare empty-object placeholder input incomplete on tool-calls finish", () => {
    const state = reduceEvents([
      {
        type: "tool_input_start",
        toolCallId: "placeholder",
        toolName: "create_file",
      },
      {
        type: "tool_input_content",
        toolCallId: "placeholder",
        delta: "{}",
      },
      { type: "step_finish", finishReason: "tool-calls" },
    ]);

    assertEquals(state.snapshot.phase, "failed");
    assertEquals(state.terminalError?.code, "TOOL_INPUT_INCOMPLETE");
    assertEquals(state.snapshot.tools.map((tool) => [tool.id, tool.phase, tool.rejectionReason]), [
      ["placeholder", "input_rejected", "invalid"],
    ]);
    assertEquals(collectCommittedLocalToolCalls(state.snapshot), []);
  });

  it("commits object-ready tool input as serialized arguments when no deltas streamed", () => {
    const state = reduceEvents([
      {
        type: "tool_input_start",
        toolCallId: "t1",
        toolName: "create_file",
      },
      {
        type: "tool_input_ready",
        toolCallId: "t1",
        toolName: "create_file",
        input: { path: "a.md" },
      },
      { type: "step_finish", finishReason: "tool-calls" },
    ]);

    assertEquals(state.snapshot.phase, "tool_handoff");
    assertEquals(state.snapshot.tools[0]?.inputText, '{"path":"a.md"}');
    assertEquals(collectCommittedLocalToolCalls(state.snapshot), [
      {
        id: "t1",
        name: "create_file",
        arguments: '{"path":"a.md"}',
        inputDeltas: [],
        inputAnnounced: true,
        inputAvailable: true,
        providerExecuted: false,
      },
    ]);
  });

  it("fails closed when ready tool input cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const state = reduceEvents([
      {
        type: "tool_input_start",
        toolCallId: "t1",
        toolName: "create_file",
      },
      {
        type: "tool_input_ready",
        toolCallId: "t1",
        toolName: "create_file",
        input: circular,
      },
    ]);

    assertEquals(state.snapshot.tools[0]?.inputText, "null");
  });

  it("rejects tool input content after committed tool phases without regressing the snapshot", () => {
    const cases = [
      {
        name: "input_ready",
        expectedPhase: "input_ready",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "create_file",
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "create_file",
            input: { path: "ready.md" },
          },
        ],
      },
      {
        name: "running",
        expectedPhase: "running",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
        ],
      },
      {
        name: "succeeded",
        expectedPhase: "succeeded",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "provider_tool_result",
            toolCallId: "t1",
            toolName: "web_search",
            output: "ok",
            isError: false,
            providerExecuted: true,
          },
        ],
      },
      {
        name: "failed",
        expectedPhase: "failed",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "provider_tool_result",
            toolCallId: "t1",
            toolName: "web_search",
            output: "provider failed",
            isError: true,
            providerExecuted: true,
          },
        ],
      },
      {
        name: "denied",
        expectedPhase: "denied",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "provider_tool_denied",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
        ],
      },
      {
        name: "cancelled",
        expectedPhase: "cancelled",
        events: [
          {
            type: "tool_input_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "tool_input_ready",
            toolCallId: "t1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true,
          },
          {
            type: "provider_tool_start",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
          {
            type: "provider_tool_cancelled",
            toolCallId: "t1",
            toolName: "web_search",
            providerExecuted: true,
          },
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const before = reduceEvents(testCase.events);
      const beforeTool = before.snapshot.tools[0];
      const reduced = reduceStreamSignal(
        before,
        protocol({
          type: "tool_input_content",
          toolCallId: "t1",
          delta: '{"late":true}',
        }),
        99,
      );

      assertEquals(reduced.state.snapshot.phase, "failed", testCase.name);
      assertEquals(reduced.state.terminalError?.code, "PROTOCOL_VIOLATION", testCase.name);
      assertEquals(reduced.state.snapshot.tools[0], beforeTool, testCase.name);
      assertEquals(reduced.state.snapshot.tools[0]?.phase, testCase.expectedPhase, testCase.name);
      assertEquals(
        reduced.frames.some((frame) =>
          frame.class === "diagnostic" &&
          frame.event.type === "protocol_violation" &&
          frame.event.code === "invalid_tool_transition"
        ),
        true,
        testCase.name,
      );
    }
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

  it("keeps provider tools running across preliminary output", () => {
    let state = reduceEvents([
      {
        type: "tool_input_start",
        toolCallId: "native-1",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "tool_input_ready",
        toolCallId: "native-1",
        toolName: "web_fetch",
        input: { url: "https://docs.example/page" },
        providerExecuted: true,
      },
      {
        type: "provider_tool_start",
        toolCallId: "native-1",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "provider_tool_result",
        toolCallId: "native-1",
        toolName: "web_fetch",
        output: { partial: true },
        isError: false,
        providerExecuted: true,
        preliminary: true,
      },
    ]);

    assertEquals(state.snapshot.phase, "streaming");
    assertEquals(state.snapshot.tools[0]?.phase, "running");

    state = reduceStreamSignal(
      state,
      protocol({
        type: "provider_tool_result",
        toolCallId: "native-1",
        toolName: "web_fetch",
        output: { content: "final" },
        isError: false,
        providerExecuted: true,
      }),
      5,
    ).state;

    assertEquals(state.snapshot.phase, "streaming");
    assertEquals(state.snapshot.tools[0]?.phase, "succeeded");
    assertEquals(state.snapshot.tools[0]?.output, { content: "final" });
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
