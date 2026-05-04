import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type {
  ChatToolResultOutput,
  ChatToolResultPart,
  ProviderModelMessage,
} from "../chat/types.ts";
import {
  type AgentRuntimeMessage,
  type AgentRuntimeMessagePart,
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./agent-runtime-message-adapter.ts";

type ProviderStructuredPart = Exclude<ProviderModelMessage["content"], string>[number];

const TOOL_CALL_ID = "tool-1";
const TOOL_NAME = "search_files";

function providerMessage(message: ProviderModelMessage): ProviderModelMessage {
  return message;
}

function providerTextPart(text: string): ProviderStructuredPart {
  return { type: "text", text };
}

function providerToolCallPart(input: Record<string, unknown>): ProviderStructuredPart {
  return {
    type: "tool-call",
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    input,
  };
}

function jsonOutput(value: ChatToolResultOutput["value"]): ChatToolResultOutput {
  return {
    type: "json",
    value,
  };
}

function providerToolResultPart(output: ChatToolResultOutput): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    output,
  };
}

function agentRuntimeMessage(
  role: AgentRuntimeMessage["role"],
  parts: AgentRuntimeMessagePart[],
  timestamp: number,
): AgentRuntimeMessage {
  return {
    id: `agent-runtime-${role}-${timestamp + 1}`,
    role,
    parts,
    timestamp,
  };
}

function agentRuntimeTextPart(text: string): AgentRuntimeMessagePart {
  return { type: "text", text };
}

function agentRuntimeToolCallPart(
  args: Record<string, unknown>,
  type = "tool-call",
): AgentRuntimeMessagePart {
  return {
    type,
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    args,
  };
}

function agentRuntimeToolResultPart(result: unknown): AgentRuntimeMessagePart {
  return {
    type: "tool-result",
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    result,
  };
}

describe("agent runtime message adapter", () => {
  it("converts text, tool-call, and tool-result provider model messages into agent runtime messages", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({ role: "system", content: "System instructions" }),
      providerMessage({
        role: "assistant",
        content: [providerTextPart("Searching…"), providerToolCallPart({ query: "chat runtime" })],
      }),
      providerMessage({
        role: "tool",
        content: [providerToolResultPart(jsonOutput({ matches: 2 }))],
      }),
    ]);

    assertEquals(agentRuntimeMessages, [
      agentRuntimeMessage("system", [agentRuntimeTextPart("System instructions")], 0),
      agentRuntimeMessage(
        "assistant",
        [agentRuntimeTextPart("Searching…"), agentRuntimeToolCallPart({ query: "chat runtime" })],
        1,
      ),
      agentRuntimeMessage("tool", [agentRuntimeToolResultPart(jsonOutput({ matches: 2 }))], 2),
    ]);
  });

  it("ignores reasoning-only parts when converting agent runtime messages", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Hidden thinking",
          },
          providerTextPart("Visible answer"),
        ],
      }),
    ]);

    assertEquals(agentRuntimeMessages[0]?.parts, [agentRuntimeTextPart("Visible answer")]);
  });

  it("converts multimodal parts into uploaded-file context annotations", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "user",
        content: [
          {
            type: "image",
            data: "ignored",
            mediaType: "image/png",
            filename: "diagram.png",
          },
          {
            type: "file",
            data: "ignored",
            mediaType: "application/pdf",
            filename: "spec.pdf",
            url: "https://example.com/spec.pdf",
          },
        ],
      }),
    ]);

    assertEquals(agentRuntimeMessages[0]?.parts.length, 1);
    const firstPart = agentRuntimeMessages[0]?.parts[0];
    assertEquals(firstPart?.type, "text");
    if (firstPart && "text" in firstPart) {
      assertStringIncludes(firstPart.text, "<uploaded_files>");
      assertStringIncludes(firstPart.text, "diagram.png");
      assertStringIncludes(firstPart.text, "spec.pdf");
    }
  });

  it("converts agent runtime tool-prefixed parts back into provider model messages", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      agentRuntimeMessage("user", [agentRuntimeTextPart("Inspect the rollout state.")], 0),
      agentRuntimeMessage(
        "assistant",
        [
          agentRuntimeTextPart("Looking now."),
          agentRuntimeToolCallPart({ query: "rollout" }, "tool-search_files"),
        ],
        1,
      ),
      agentRuntimeMessage("tool", [agentRuntimeToolResultPart({ matches: 2 })], 2),
    ]);

    assertEquals(providerMessages, [
      { role: "user", content: "Inspect the rollout state." },
      {
        role: "assistant",
        content: [providerTextPart("Looking now."), providerToolCallPart({ query: "rollout" })],
      },
      {
        role: "tool",
        content: [
          providerToolResultPart(jsonOutput({ matches: 2 })),
        ],
      },
    ]);
  });

  it("skips empty agent runtime messages that do not contribute model content", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      agentRuntimeMessage("assistant", [], 0),
      agentRuntimeMessage("tool", [], 1),
    ]);

    assertEquals(providerMessages, []);
  });
});
