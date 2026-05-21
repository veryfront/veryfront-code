import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import type { ProviderModelMessage } from "./types.ts";
import {
  compressTurn,
  enforceTokenBudget,
  estimateTokens,
  maskOldToolOutputs,
  prepareProviderModelMessagesFromUiMessages,
  repairToolPairs,
  rewriteUnsupportedFilePartsAsAnnotations,
  stripPendingToolParts,
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
  assertEquals(repaired, [messages[0]!, messages[1]!, messages[3]!, messages[2]!]);
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
  ] satisfies ProviderModelMessage[];

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

  assertMatch(String(compacted[0]!.content), /^\[Compressed:/);
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
  assertStringIncludes(
    String(compressed[0]!.content),
    "[Compressed: please do something important",
  );
  assertEquals(compressed[1], {
    role: "assistant",
    content: "Acknowledged.",
  });
});

Deno.test("stripPendingToolParts removes stale assistant tool calls before model conversion", () => {
  const messages = [
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "Let me ask one thing." },
        {
          type: "dynamic-tool" as const,
          toolName: "form_input",
          toolCallId: "tool-form",
          state: "input-available" as const,
          input: { title: "Intake" },
        },
      ],
    },
  ];

  assertEquals(stripPendingToolParts(messages), [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Let me ask one thing." }],
    },
  ]);
});

Deno.test("rewriteUnsupportedFilePartsAsAnnotations converts non-model-native files into text annotations", () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      parts: [
        { type: "text" as const, text: "Read this data." },
        {
          type: "file" as const,
          mediaType: "application/zip",
          filename: "archive.zip",
          uploadId: "upload-zip",
          uploadPath: "uploads/archive.zip",
          url: "https://files.example.com/archive.zip",
        },
      ],
    },
  ];

  assertEquals(rewriteUnsupportedFilePartsAsAnnotations(messages)[0]!.parts, [
    {
      type: "text",
      text: "Read this data.\n\n<uploaded_files>\n" +
        '<file name="archive.zip" upload_id="upload-zip" path="uploads/archive.zip" ' +
        'url="https://files.example.com/archive.zip" type="application/zip" />\n' +
        "</uploaded_files>",
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages normalizes UI history into provider-safe tool order", () => {
  const prepared = prepareProviderModelMessagesFromUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Inspect rollout state." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "search_files",
          toolCallId: "tool-1",
          state: "output-available",
          input: { query: "rollout" },
          output: { matches: 2 },
        },
      ],
    },
  ]);

  assertEquals(prepared, [
    {
      role: "user",
      content: [{ type: "text", text: "Inspect rollout state." }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "search_files",
          input: { query: "rollout" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "search_files",
          output: {
            type: "json",
            value: { matches: 2 },
          },
        },
      ],
    },
  ]);
});

Deno.test("prepareProviderModelMessagesFromUiMessages prefers completed tool output over superseded stopped errors", () => {
  const prepared = prepareProviderModelMessagesFromUiMessages([
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Search my notes." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "notion__search_notion",
          toolCallId: "toolu_01Search",
          input: { query: "research notes" },
          state: "output-error",
          providerExecuted: true,
          renderMode: "tool_call",
          errorText: "Stopped by user",
        },
        {
          type: "dynamic-tool",
          toolName: "notion__search_notion",
          toolCallId: "toolu_01Search",
          input: { query: "research notes" },
          state: "output-available",
          providerExecuted: true,
          renderMode: "tool_result",
          output: { data: [] },
        },
      ],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Create a template I can use." }],
    },
  ]);

  assertEquals(prepared, [
    {
      role: "user",
      content: [{ type: "text", text: "Search my notes." }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "toolu_01Search",
          toolName: "notion__search_notion",
          input: { query: "research notes" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "toolu_01Search",
          toolName: "notion__search_notion",
          output: {
            type: "json",
            value: { data: [] },
          },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Create a template I can use." }],
    },
  ]);
});
