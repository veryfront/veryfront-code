import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ClaudeCodeAllToolCall,
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  isClaudeCodeCoreEvent,
  MAX_CLAUDE_CODE_ACCUMULATED_TEXT_LENGTH,
  MAX_CLAUDE_CODE_TRACKED_TOOL_CALLS,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import type {
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClaudeCodeResult,
} from "#veryfront/workflow/claude-code/types.ts";
import { MAX_CLAUDE_CODE_EVENT_HISTORY } from "./event-protocol.ts";

function result(overrides: Partial<ClaudeCodeResult> = {}): ClaudeCodeResult {
  return {
    success: true,
    iterations: 1,
    response: "done",
    filesModified: [],
    commandsExecuted: [],
    executionTime: 12,
    ...overrides,
  };
}

describe("workflow/claude-code/react/event-state-reducer", () => {
  it("reduces shared iteration, text, tool, and completion events", () => {
    const finalResult = result();
    const events: ClaudeCodeEvent[] = [
      {
        type: "iteration_start",
        timestamp: 1,
        iteration: 2,
        maxIterations: 5,
      },
      {
        type: "text_delta",
        timestamp: 2,
        content: "hel",
      },
      {
        type: "text_delta",
        timestamp: 3,
        content: "lo",
      },
      {
        type: "tool_call_start",
        timestamp: 4,
        toolCallId: "tool-1",
        toolName: "read",
      },
      {
        type: "tool_call_complete",
        timestamp: 5,
        toolCallId: "tool-1",
        toolName: "read",
        input: { path: "README.md" },
      },
      {
        type: "tool_result",
        timestamp: 6,
        toolCallId: "tool-1",
        toolName: "read",
        output: "contents",
        isError: false,
      },
      {
        type: "complete",
        timestamp: 7,
        result: finalResult,
      },
    ];
    const state = events.reduce(
      (previous, event) => reduceClaudeCodeEventState(previous, event),
      createClaudeCodeEventState(),
    );

    assertEquals(state, {
      isRunning: false,
      currentIteration: 2,
      maxIterations: 5,
      text: "hello",
      currentTool: null,
      toolCalls: [
        {
          id: "tool-1",
          name: "read",
          input: { path: "README.md" },
          output: "contents",
          isError: false,
        },
      ],
      result: finalResult,
      error: null,
    });
  });

  it("keeps bounded event history and all-iteration tool calls when requested", () => {
    const events: ClaudeCodeEvent[] = [
      {
        type: "iteration_start",
        timestamp: 1,
        iteration: 3,
        maxIterations: 8,
      },
      {
        type: "tool_call_complete",
        timestamp: 2,
        toolCallId: "tool-2",
        toolName: "bash",
        input: { command: "deno test" },
      },
      {
        type: "tool_result",
        timestamp: 3,
        toolCallId: "tool-2",
        toolName: "bash",
        output: "ok",
        isError: false,
      },
    ];
    const initialState: ClaudeCodeEventState & {
      events: ClaudeCodeEvent[];
      allToolCalls: ClaudeCodeAllToolCall[];
    } = {
      ...createClaudeCodeEventState(),
      events: [],
      allToolCalls: [],
    };
    const state = events.reduce(
      (previous, event) =>
        reduceClaudeCodeEventState(previous, event, {
          keepEventHistory: true,
          maxEventHistory: 2,
          trackAllToolCalls: true,
        }),
      initialState,
    );

    assertEquals(
      state.events.map((event) => event.type),
      ["tool_call_complete", "tool_result"],
    );
    assertEquals(state.allToolCalls, [
      {
        iteration: 3,
        id: "tool-2",
        name: "bash",
        input: { command: "deno test" },
        output: "ok",
        isError: false,
      },
    ]);
  });

  it("caps caller-supplied event history limits", () => {
    const events: ClaudeCodeEvent[] = Array.from(
      { length: MAX_CLAUDE_CODE_EVENT_HISTORY + 1 },
      (_, index) => ({
        type: "text_delta",
        timestamp: index,
        content: "x",
      }),
    );
    const initialState: ClaudeCodeEventState & { events: ClaudeCodeEvent[] } = {
      ...createClaudeCodeEventState(),
      events: [],
    };

    const state = events.reduce(
      (previous, event) =>
        reduceClaudeCodeEventState(previous, event, {
          keepEventHistory: true,
          maxEventHistory: Number.MAX_SAFE_INTEGER,
        }),
      initialState,
    );

    assertEquals(state.events.length, MAX_CLAUDE_CODE_EVENT_HISTORY);
  });

  it("bounds cumulative text across individually admitted deltas", () => {
    const chunk = "x".repeat(1024);
    let state = createClaudeCodeEventState();
    for (let index = 0; index <= MAX_CLAUDE_CODE_ACCUMULATED_TEXT_LENGTH / 1024; index++) {
      state = reduceClaudeCodeEventState(state, {
        type: "text_delta",
        timestamp: index,
        content: chunk,
      });
    }

    assertEquals(state.text.length, MAX_CLAUDE_CODE_ACCUMULATED_TEXT_LENGTH);
    assertEquals(state.error, "Claude Code streaming text exceeded the retained text limit");
  });

  it("bounds current and all-iteration tool-call collections at 1,000 entries", () => {
    let state: ClaudeCodeEventState & { allToolCalls: ClaudeCodeAllToolCall[] } = {
      ...createClaudeCodeEventState(),
      allToolCalls: [],
    };
    for (let index = 0; index <= MAX_CLAUDE_CODE_TRACKED_TOOL_CALLS; index++) {
      const toolCallId = `tool-${index}`;
      state = reduceClaudeCodeEventState(state, {
        type: "tool_call_complete",
        timestamp: index * 2,
        toolCallId,
        toolName: "read",
        input: { index },
      }, { trackAllToolCalls: true });
      state = reduceClaudeCodeEventState(state, {
        type: "tool_result",
        timestamp: index * 2 + 1,
        toolCallId,
        toolName: "read",
        output: "ok",
        isError: false,
      }, { trackAllToolCalls: true });
    }

    assertEquals(state.toolCalls.length, MAX_CLAUDE_CODE_TRACKED_TOOL_CALLS);
    assertEquals(state.allToolCalls.length, MAX_CLAUDE_CODE_TRACKED_TOOL_CALLS);
    assertEquals(state.toolCalls[0]?.id, "tool-1");
    assertEquals(state.allToolCalls[0]?.id, "tool-1");
    assertEquals(state.error, "Claude Code tool calls exceeded the retained collection limit");
  });

  it("identifies core events and rejects websocket-only events", () => {
    const events: ClaudeCodeEventExtended[] = [
      { type: "pong", timestamp: 1 },
      { type: "cancelled", timestamp: 2 },
      { type: "text_complete", timestamp: 3, content: "done" },
    ];

    assertEquals(events.map(isClaudeCodeCoreEvent), [false, false, true]);
  });
});
