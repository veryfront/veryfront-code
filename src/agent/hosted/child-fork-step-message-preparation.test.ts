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

Deno.test("prepareHostedChildForkRuntimeStepMessages preserves same-message assistant tool results", () => {
  const messages: AgentRuntimeMessage[] = [
    {
      id: "assistant-message-1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          args: { path: "README.md" },
        },
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          result: { content: "hello" },
        },
      ],
      timestamp: 1,
    },
  ];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages,
    buildInstructions: () => "Base instructions",
    forkToolNames: ["read_file"],
  });

  assertEquals(prepared.messages, [
    {
      id: "agent-runtime-assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          args: { path: "README.md" },
        },
      ],
      timestamp: 0,
    },
    {
      id: "agent-runtime-tool-2",
      role: "tool",
      parts: [
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "read_file",
          result: {
            type: "json",
            value: { content: "hello" },
          },
        },
      ],
      timestamp: 1,
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

Deno.test("prepareHostedChildForkRuntimeStepMessages returns live forkToolNames when getActivatedToolNames provided", () => {
  const activated = new Set(["read_file", "write_file"]);
  const pinned = ["load_skill", "search_tools", "load_tools"];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: pinned, // static pinned names
    pinnedToolNames: pinned,
    getActivatedToolNames: () => [...activated],
  });

  // forkToolNames in result = pinned ∪ activated, sorted
  assertEquals(prepared.forkToolNames?.sort(), [
    "load_skill",
    "load_tools",
    "read_file",
    "search_tools",
    "write_file",
  ]);
});

Deno.test("prepareHostedChildForkRuntimeStepMessages omits forkToolNames when no activated getter provided", () => {
  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: ["load_skill"],
  });

  // No getter provided — caller should keep using its own fixed forkToolNames
  assertEquals(prepared.forkToolNames, undefined);
});

Deno.test("prepareHostedChildForkRuntimeStepMessages deduplicates pinned and activated names", () => {
  const activated = new Set(["load_skill", "new_tool"]); // load_skill is also pinned
  const pinned = ["load_skill", "search_tools"];

  const prepared = prepareHostedChildForkRuntimeStepMessages({
    messages: [],
    buildInstructions: () => "Instructions",
    forkToolNames: pinned,
    pinnedToolNames: pinned,
    getActivatedToolNames: () => [...activated],
  });

  // load_skill must appear only once
  const names = prepared.forkToolNames ?? [];
  const loadSkillCount = names.filter((n) => n === "load_skill").length;
  assertEquals(loadSkillCount, 1);
  assertEquals(names.sort(), ["load_skill", "new_tool", "search_tools"]);
});
