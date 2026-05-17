import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import {
  convertCompactedProviderMessagesToChildForkRuntimeMessages,
  prepareHostedChildForkRuntimeStepMessages,
} from "./child-fork-step-message-preparation.ts";

Deno.test("convertCompactedProviderMessagesToChildForkRuntimeMessages rewrites tool-call part types", () => {
  const messages = convertCompactedProviderMessagesToChildForkRuntimeMessages([
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          input: { path: "README.md" },
        },
      ],
    },
  ]);

  assertEquals(messages[0]?.parts[0], {
    type: "tool-read_file",
    toolCallId: "tool-call-1",
    toolName: "read_file",
    args: { path: "README.md" },
  });
});

Deno.test("prepareHostedChildForkRuntimeStepMessages compacts messages and resolves system text", () => {
  const messages: AgentRuntimeMessage[] = [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Create a report" }],
      timestamp: 1,
    },
    {
      id: "message-2",
      role: "assistant",
      parts: [{ type: "text", text: "Trailing assistant draft" }],
      timestamp: 2,
    },
  ];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages,
    buildInstructions: () => "Base instructions",
    forkToolNames: ["read_file", "create_file"],
    resolveSystem: ({ system, compactedMessages }) =>
      compactedMessages.length === 1 ? `${system}\n\nContinuation reminder` : system,
  });

  assertEquals(prepared.system, "Base instructions\n\nContinuation reminder");
  assertEquals(prepared.messages, [
    {
      id: "agent-runtime-user-1",
      role: "user",
      parts: [{ type: "text", text: "Create a report" }],
      timestamp: 0,
    },
  ]);
});

Deno.test("prepareHostedChildForkRuntimeStepMessages falls back to current instructions", () => {
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Current instructions",
    forkToolNames: [],
    resolveSystem: () => null,
  });

  assertEquals(prepared.system, "Current instructions");
  assertEquals(prepared.messages, []);
});
