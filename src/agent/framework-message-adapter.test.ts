import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatModelMessage, ChatToolResultOutput, ChatToolResultPart } from "../chat/types.ts";
import {
  convertFrameworkMessagesToModelMessages,
  convertModelMessagesToFrameworkMessages,
  type FrameworkMessage,
  type FrameworkMessagePart,
} from "./framework-message-adapter.ts";

type ModelStructuredPart = Exclude<ChatModelMessage["content"], string>[number];

const TOOL_CALL_ID = "tool-1";
const TOOL_NAME = "search_files";

function modelMessage(message: ChatModelMessage): ChatModelMessage {
  return message;
}

function modelTextPart(text: string): ModelStructuredPart {
  return { type: "text", text };
}

function modelToolCallPart(input: Record<string, unknown>): ModelStructuredPart {
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

function modelToolResultPart(output: ChatToolResultOutput): ChatToolResultPart {
  return {
    type: "tool-result",
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    output,
  };
}

function frameworkMessage(
  role: FrameworkMessage["role"],
  parts: FrameworkMessagePart[],
  timestamp: number,
): FrameworkMessage {
  return {
    id: `framework-${role}-${timestamp + 1}`,
    role,
    parts,
    timestamp,
  };
}

function frameworkTextPart(text: string): FrameworkMessagePart {
  return { type: "text", text };
}

function frameworkToolCallPart(
  args: Record<string, unknown>,
  type = "tool-call",
): FrameworkMessagePart {
  return {
    type,
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    args,
  };
}

function frameworkToolResultPart(result: unknown): FrameworkMessagePart {
  return {
    type: "tool-result",
    toolCallId: TOOL_CALL_ID,
    toolName: TOOL_NAME,
    result,
  };
}

describe("framework message adapter", () => {
  it("converts text, tool-call, and tool-result model messages into framework messages", () => {
    const frameworkMessages = convertModelMessagesToFrameworkMessages([
      modelMessage({ role: "system", content: "System instructions" }),
      modelMessage({
        role: "assistant",
        content: [modelTextPart("Searching…"), modelToolCallPart({ query: "chat runtime" })],
      }),
      modelMessage({
        role: "tool",
        content: [modelToolResultPart(jsonOutput({ matches: 2 }))],
      }),
    ]);

    assertEquals(frameworkMessages, [
      frameworkMessage("system", [frameworkTextPart("System instructions")], 0),
      frameworkMessage(
        "assistant",
        [frameworkTextPart("Searching…"), frameworkToolCallPart({ query: "chat runtime" })],
        1,
      ),
      frameworkMessage("tool", [frameworkToolResultPart(jsonOutput({ matches: 2 }))], 2),
    ]);
  });

  it("ignores reasoning-only parts when converting framework messages", () => {
    const frameworkMessages = convertModelMessagesToFrameworkMessages([
      modelMessage({
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Hidden thinking",
          },
          modelTextPart("Visible answer"),
        ],
      }),
    ]);

    assertEquals(frameworkMessages[0]?.parts, [frameworkTextPart("Visible answer")]);
  });

  it("converts multimodal parts into uploaded-file context annotations", () => {
    const frameworkMessages = convertModelMessagesToFrameworkMessages([
      modelMessage({
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

    assertEquals(frameworkMessages[0]?.parts.length, 1);
    const firstPart = frameworkMessages[0]?.parts[0];
    assertEquals(firstPart?.type, "text");
    if (firstPart && "text" in firstPart) {
      assertStringIncludes(firstPart.text, "<uploaded_files>");
      assertStringIncludes(firstPart.text, "diagram.png");
      assertStringIncludes(firstPart.text, "spec.pdf");
    }
  });

  it("converts framework tool-prefixed parts back into model messages", () => {
    const modelMessages = convertFrameworkMessagesToModelMessages([
      frameworkMessage("user", [frameworkTextPart("Inspect the rollout state.")], 0),
      frameworkMessage(
        "assistant",
        [
          frameworkTextPart("Looking now."),
          frameworkToolCallPart({ query: "rollout" }, "tool-search_files"),
        ],
        1,
      ),
      frameworkMessage("tool", [frameworkToolResultPart({ matches: 2 })], 2),
    ]);

    assertEquals(modelMessages, [
      { role: "user", content: "Inspect the rollout state." },
      {
        role: "assistant",
        content: [modelTextPart("Looking now."), modelToolCallPart({ query: "rollout" })],
      },
      {
        role: "tool",
        content: [
          modelToolResultPart(jsonOutput({ matches: 2 })),
        ],
      },
    ]);
  });

  it("skips empty framework messages that do not contribute model content", () => {
    const modelMessages = convertFrameworkMessagesToModelMessages([
      frameworkMessage("assistant", [], 0),
      frameworkMessage("tool", [], 1),
    ]);

    assertEquals(modelMessages, []);
  });
});
