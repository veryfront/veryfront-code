import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type {
  ChatToolResultOutput,
  ChatToolResultPart,
  ProviderModelMessage,
} from "../../chat/types.ts";
import {
  type AgentRuntimeMessage,
  type AgentRuntimeMessagePart,
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./message-adapter.ts";

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

  it("passes image and file parts with URLs as native AgentRuntimeMessage parts", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "user",
        content: [
          {
            type: "image",
            mediaType: "image/png",
            filename: "diagram.png",
            url: "https://uploads.example.com/diagram.png",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "spec.pdf",
            url: "https://uploads.example.com/spec.pdf",
          },
        ],
      }),
    ]);

    const parts = agentRuntimeMessages[0]?.parts ?? [];
    assertEquals(
      parts.some((part) =>
        part.type === "image" &&
        "url" in part &&
        part.url === "https://uploads.example.com/diagram.png" &&
        part.mediaType === "image/png"
      ),
      true,
    );
    assertEquals(
      parts.some((part) =>
        part.type === "file" &&
        "url" in part &&
        part.url === "https://uploads.example.com/spec.pdf" &&
        part.mediaType === "application/pdf"
      ),
      true,
    );
  });

  it("keeps user attachments visible as text context when native file parts are emitted", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "user",
        content: [
          { type: "text", text: "Sent with attachments" },
          {
            type: "file",
            data: "https://signed.example.com/invoice.pdf",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
            uploadId: "test-upload-id",
            uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          },
        ],
      }),
    ]);

    const parts = agentRuntimeMessages[0]?.parts ?? [];
    assertEquals(parts.some((part) => part.type === "file"), true);

    const text = parts
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");

    assertStringIncludes(text, "Sent with attachments");
    assertStringIncludes(text, "<uploaded_files>");
    assertStringIncludes(text, "sample-attachment.pdf");
    assertStringIncludes(text, "test-upload-id");
    assertStringIncludes(text, "application/pdf");
  });

  it("does not append a second uploaded files annotation during provider round trips", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "user",
        content: [
          {
            type: "text",
            text:
              'Sent with attachments\n<uploaded_files>[{"name":"sample-attachment.pdf","mediaType":"application/pdf","uploadId":"test-upload-id"}]</uploaded_files>',
          },
          {
            type: "file",
            data: "https://signed.example.com/invoice.pdf",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
            uploadId: "test-upload-id",
            uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          },
        ],
      }),
    ]);

    const textParts = (agentRuntimeMessages[0]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : []);

    assertEquals(textParts.length, 1);
    assertEquals(textParts.join("\n").split("<uploaded_files>").length - 1, 1);
  });

  it("falls back to annotation for multimodal parts without a URL", () => {
    const agentRuntimeMessages = convertProviderMessagesToAgentRuntimeMessages([
      providerMessage({
        role: "user",
        content: [
          {
            type: "image",
            data: "base64data",
            mediaType: "image/png",
            filename: "diagram.png",
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

  it("preserves stored snake_case tool-call and tool-result parts when replaying agent runtime messages", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: TOOL_CALL_ID,
            name: TOOL_NAME,
            input: { query: "rollout" },
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: TOOL_CALL_ID,
            tool_name: TOOL_NAME,
            output: { matches: 2 },
          },
        ],
      },
    ]);

    assertEquals(providerMessages, [
      {
        role: "assistant",
        content: [providerToolCallPart({ query: "rollout" })],
      },
      {
        role: "tool",
        content: [
          providerToolResultPart(jsonOutput({ matches: 2 })),
        ],
      },
    ]);
  });

  it("normalizes stored dashed tool-result parts without output when replaying agent runtime messages", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: TOOL_CALL_ID,
            toolName: TOOL_NAME,
          },
        ],
      },
    ]);

    assertEquals(providerMessages, [
      {
        role: "tool",
        content: [
          providerToolResultPart(jsonOutput(null)),
        ],
      },
    ]);
  });

  it("converts native image AgentRuntimeMessage part back to structured user content", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      agentRuntimeMessage(
        "user",
        [
          agentRuntimeTextPart("What is in this image?"),
          { type: "image", url: "https://uploads.example.com/photo.jpg", mediaType: "image/jpeg" },
        ],
        0,
      ),
    ]);

    assertEquals(providerMessages, [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", url: "https://uploads.example.com/photo.jpg", mediaType: "image/jpeg" },
        ],
      },
    ]);
  });

  it("does not drop a file-only user message — emits structured content with the file part", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      agentRuntimeMessage(
        "user",
        [
          {
            type: "image",
            url: "https://uploads.example.com/screenshot.png",
            mediaType: "image/png",
          },
        ],
        0,
      ),
    ]);

    assertEquals(providerMessages, [
      {
        role: "user",
        content: [
          {
            type: "image",
            url: "https://uploads.example.com/screenshot.png",
            mediaType: "image/png",
          },
        ],
      },
    ]);
  });

  it("drops a data: URL image part when converting back to provider messages", () => {
    const providerMessages = convertAgentRuntimeMessagesToProviderMessages([
      agentRuntimeMessage(
        "user",
        [
          agentRuntimeTextPart("Here is my image."),
          {
            type: "image",
            url: "data:image/png;base64,abc123==",
            mediaType: "image/png",
          },
        ],
        0,
      ),
    ]);

    assertEquals(providerMessages, [
      { role: "user", content: "Here is my image." },
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
