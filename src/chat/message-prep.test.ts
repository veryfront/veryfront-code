import { assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import type { ChatModelMessage } from "./types.ts";
import {
  compressTurn,
  enforceTokenBudget,
  estimateTokens,
  maskOldToolOutputs,
  repairToolPairs,
} from "./message-prep.ts";

Deno.test("repairToolPairs moves a later tool result immediately after the matching tool call", () => {
  const messages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: "I want to build a bank" }],
    },
    {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Let me gather one more detail first." },
        {
          type: "tool-call" as const,
          toolCallId: "tool-form",
          toolName: "form_input",
          input: { title: "Bank builder intake" },
        },
      ],
    },
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Waiting for your response." }],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "tool-form",
          toolName: "form_input",
          output: {
            type: "json" as const,
            value: {
              submitted: true,
              values: {
                bank_type: "dashboard",
              },
            },
          },
        },
      ],
    },
  ];

  const repaired = repairToolPairs(messages);
  const serialized = JSON.stringify(repaired);
  const toolResultMatches = serialized.match(/"toolCallId":"tool-form"/g) ?? [];
  const unavailableMatches = serialized.match(/\[tool result unavailable\]/g) ?? [];

  assertEquals(toolResultMatches.length, 2);
  assertEquals(unavailableMatches.length, 0);
  assertEquals(repaired, [messages[0], messages[1], messages[3], messages[2]]);
});

Deno.test("maskOldToolOutputs masks large historical tool outputs and removes stale reasoning before the latest user turn", () => {
  const messages = [
    { role: "user", content: "run the check" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "old private chain" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "bash",
          input: { command: "npm test" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "bash",
          output: { type: "json", value: { exitCode: 0, stdout: "x".repeat(600) } },
        },
      ],
    },
    { role: "user", content: "now summarize it" },
  ] satisfies ChatModelMessage[];

  const masked = maskOldToolOutputs(messages);

  assertEquals(masked[1], {
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "bash",
      input: { command: "npm test" },
    }],
  });
  assertStringIncludes(JSON.stringify(masked[2]), "[Command: npm test — exit 0, output omitted");
  assertEquals(masked[3], messages[3]);
});

Deno.test("enforceTokenBudget compresses the oldest turn before dropping later turns", () => {
  const messages = [
    { role: "user" as const, content: "old request ".repeat(100) },
    { role: "assistant" as const, content: "old answer ".repeat(100) },
    { role: "user" as const, content: "middle request ".repeat(5) },
    { role: "assistant" as const, content: "middle answer ".repeat(5) },
    { role: "user" as const, content: "latest request ".repeat(5) },
    { role: "assistant" as const, content: "latest answer ".repeat(5) },
  ];

  const totalTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const compacted = enforceTokenBudget(messages, totalTokens - 1);

  assertMatch(String(compacted[0].content), /^\[Compressed:/);
  assertEquals(compacted[1], {
    role: "assistant",
    content: "Acknowledged.",
  });
  assertEquals(compacted.slice(-2), messages.slice(-2));
});

Deno.test("enforceTokenBudget can still drop the oldest compressed turn when the budget remains too small", () => {
  const messages = [
    { role: "user" as const, content: "turn one ".repeat(120) },
    { role: "assistant" as const, content: "answer one ".repeat(120) },
    { role: "user" as const, content: "turn two ".repeat(120) },
    { role: "assistant" as const, content: "answer two ".repeat(120) },
    { role: "user" as const, content: "turn three ".repeat(120) },
    { role: "assistant" as const, content: "answer three ".repeat(120) },
    { role: "user" as const, content: "turn four ".repeat(120) },
    { role: "assistant" as const, content: "answer four ".repeat(120) },
  ];

  const compacted = enforceTokenBudget(messages, 120);

  assertEquals(compacted.length >= 4, true);
  assertEquals(compacted[0], messages[4]);
  assertEquals(compacted[1], messages[5]);
  assertEquals(compacted[2], messages[6]);
  assertEquals(compacted[3], messages[7]);
});

Deno.test("compressTurn emits a two-message summary shell", () => {
  const messages = [
    { role: "user" as const, content: "please do something important" },
    {
      role: "assistant" as const,
      content: [
        { type: "tool-call" as const, toolCallId: "tool-1", toolName: "web_search", input: {} },
        { type: "text" as const, text: "Here is the final answer." },
      ],
    },
  ];

  const compressed = compressTurn(messages, 0, 1);
  assertStringIncludes(String(compressed[0].content), "[Compressed: please do something important");
  assertEquals(compressed[1], {
    role: "assistant",
    content: "Acknowledged.",
  });
});
