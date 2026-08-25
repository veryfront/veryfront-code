import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ClaudeCodeAllToolCall,
  type ClaudeCodeEventState,
  createClaudeCodeEventState,
  isClaudeCodeCoreEvent,
  reduceClaudeCodeEventState,
} from "./event-state-reducer.ts";
import type { ClaudeCodeEvent, ClaudeCodeEventExtended, ClaudeCodeResult } from "../types.ts";

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

/** Every event type the reducer is allowed to see, per CLAUDE_CODE_CORE_EVENT_TYPES. */
const CORE_EVENT_TYPES = [
  "iteration_start",
  "text_delta",
  "text_complete",
  "tool_call_start",
  "tool_call_input",
  "tool_call_complete",
  "tool_result",
  "iteration_complete",
  "thinking_start",
  "thinking_delta",
  "thinking_complete",
  "complete",
  "error",
] as const;

/** Transport-level events that must never reach the reducer. */
const WEBSOCKET_ONLY_EVENT_TYPES = [
  "approval_request",
  "input_request",
  "pong",
  "cancelled",
  "command_ack",
] as const;

function coreEventTypes(types: readonly string[]): string[] {
  return types.filter((type) =>
    isClaudeCodeCoreEvent({ type, timestamp: 1 } as unknown as ClaudeCodeEventExtended)
  );
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

  it("identifies core events and rejects websocket-only events", () => {
    assertEquals(
      coreEventTypes(CORE_EVENT_TYPES),
      [...CORE_EVENT_TYPES],
      "every core event type must reach the reducer",
    );
    assertEquals(
      coreEventTypes(WEBSOCKET_ONLY_EVENT_TYPES),
      [],
      "websocket-only event types must never reach the reducer",
    );
  });

  it("surfaces errors and only stops the run when the error is unrecoverable", () => {
    const running = { ...createClaudeCodeEventState(), isRunning: true };

    const recoverable = reduceClaudeCodeEventState(running, {
      type: "error",
      timestamp: 1,
      message: "boom",
      recoverable: true,
    });
    assertEquals(recoverable.error, "boom", "a recoverable error must surface its message");
    assertEquals(recoverable.isRunning, true, "a recoverable error must leave the run in flight");

    const fatal = reduceClaudeCodeEventState(running, {
      type: "error",
      timestamp: 2,
      message: "fatal",
      recoverable: false,
    });
    assertEquals(fatal.error, "fatal", "an unrecoverable error must surface its message");
    assertEquals(fatal.isRunning, false, "an unrecoverable error must stop the run");
  });
});
