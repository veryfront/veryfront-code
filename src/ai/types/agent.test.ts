/**
 * Tests for agent type helpers
 */
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getToolArguments,
  hasArgs,
  hasInput,
  type ToolCallPart,
  type ToolCallPartWithArgs,
  type ToolCallPartWithInput,
} from "./agent.ts";

Deno.test("getToolArguments - extracts args from ToolCallPartWithArgs", () => {
  const part: ToolCallPartWithArgs = {
    type: "tool-weather",
    toolCallId: "call_123",
    toolName: "weather",
    args: { location: "Tokyo" },
  };

  assertEquals(getToolArguments(part), { location: "Tokyo" });
});

Deno.test("getToolArguments - extracts input from ToolCallPartWithInput", () => {
  const part: ToolCallPartWithInput = {
    type: "tool-search",
    toolCallId: "call_456",
    toolName: "search",
    input: { query: "AI SDK" },
  };

  assertEquals(getToolArguments(part), { query: "AI SDK" });
});

Deno.test("getToolArguments - prefers args when both exist", () => {
  // This tests runtime behavior when an object has both fields
  const part = {
    type: "tool-hybrid" as const,
    toolCallId: "call_789",
    toolName: "hybrid",
    args: { fromArgs: true },
    input: { fromInput: true },
  } as ToolCallPart;

  assertEquals(getToolArguments(part), { fromArgs: true });
});

Deno.test("getToolArguments - throws when neither args nor input exist", () => {
  // Simulate a malformed part at runtime
  const part = {
    type: "tool-broken" as const,
    toolCallId: "call_bad",
    toolName: "broken",
  } as unknown as ToolCallPart;

  assertThrows(
    () => getToolArguments(part),
    Error,
    "Tool call part for \"broken\" (call_bad) missing both 'args' and 'input' fields",
  );
});

Deno.test("getToolArguments - handles empty args object", () => {
  const part: ToolCallPartWithArgs = {
    type: "tool-noargs",
    toolCallId: "call_empty",
    toolName: "noargs",
    args: {},
  };

  assertEquals(getToolArguments(part), {});
});

Deno.test("getToolArguments - handles empty input object", () => {
  const part: ToolCallPartWithInput = {
    type: "tool-noinput",
    toolCallId: "call_empty2",
    toolName: "noinput",
    input: {},
  };

  assertEquals(getToolArguments(part), {});
});

Deno.test("hasArgs - returns true for ToolCallPartWithArgs", () => {
  const part: ToolCallPartWithArgs = {
    type: "tool-test",
    toolCallId: "call_1",
    toolName: "test",
    args: { key: "value" },
  };

  assertEquals(hasArgs(part), true);
});

Deno.test("hasArgs - returns false for ToolCallPartWithInput", () => {
  const part: ToolCallPartWithInput = {
    type: "tool-test",
    toolCallId: "call_2",
    toolName: "test",
    input: { key: "value" },
  };

  assertEquals(hasArgs(part), false);
});

Deno.test("hasInput - returns true for ToolCallPartWithInput", () => {
  const part: ToolCallPartWithInput = {
    type: "tool-test",
    toolCallId: "call_3",
    toolName: "test",
    input: { key: "value" },
  };

  assertEquals(hasInput(part), true);
});

Deno.test("hasInput - returns false for ToolCallPartWithArgs", () => {
  const part: ToolCallPartWithArgs = {
    type: "tool-test",
    toolCallId: "call_4",
    toolName: "test",
    args: { key: "value" },
  };

  assertEquals(hasInput(part), false);
});
