import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertToTextGenerationRuntimeMessage,
  convertToTextGenerationRuntimeMessages,
} from "./text-generation-runtime-message-converter.ts";
import type {
  TextGenerationRuntimeAssistantMessage,
  TextGenerationRuntimeToolMessage,
} from "./text-generation-runtime-message-types.ts";
import type { Message } from "../types.ts";

describe("text-generation-runtime-message-converter", () => {
  describe("convertToTextGenerationRuntimeMessage", () => {
    it("converts a system message", () => {
      const msg: Message = {
        id: "s1",
        role: "system",
        parts: [{ type: "text", text: "You are helpful" }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "system", content: "You are helpful" });
    });

    it("converts a user message", () => {
      const msg: Message = {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "user", content: "Hello" });
    });

    it("concatenates multiple text parts in user message", () => {
      const msg: Message = {
        id: "u2",
        role: "user",
        parts: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "user", content: "Hello world" });
    });

    it("preserves user file parts as provider-visible attachment context", () => {
      const msg = {
        id: "u-file",
        role: "user",
        parts: [
          { type: "text", text: "Sent with attachments" },
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
            uploadId: "test-upload-id",
            uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      assertEquals(result.role, "user");
      if (typeof result.content !== "string") {
        throw new Error("Expected user content to be text fallback for current runtime");
      }
      assertStringIncludes(result.content, "Sent with attachments");
      assertStringIncludes(result.content, "<uploaded_files>");
      assertStringIncludes(result.content, "sample-attachment.pdf");
      assertStringIncludes(result.content, "test-upload-id");
      assertStringIncludes(result.content, "application/pdf");
    });

    it("separates user text from attachment context with a readable blank line", () => {
      const msg = {
        id: "u-file-spacing",
        role: "user",
        parts: [
          { type: "text", text: "Sent with attachments" },
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      if (typeof result.content !== "string") {
        throw new Error("Expected user content to be text fallback for current runtime");
      }
      assertStringIncludes(result.content, "Sent with attachments\n\n<uploaded_files>");
    });

    it("does not start file-only user attachment context with blank lines", () => {
      const msg = {
        id: "u-file-only",
        role: "user",
        parts: [
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      if (typeof result.content !== "string") {
        throw new Error("Expected user content to be text fallback for current runtime");
      }
      assertEquals(result.content.startsWith("<uploaded_files>"), true);
    });

    it("converts an assistant message with text", () => {
      const msg: Message = {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Sure, I can help." }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], { type: "text", text: "Sure, I can help." });
    });

    it("converts an assistant message with tool calls", () => {
      const msg: Message = {
        id: "a2",
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search." },
          {
            type: "tool-search",
            toolCallId: "tc1",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 2);
      assertEquals(content[0], { type: "text", text: "Let me search." });
      assertEquals(content[1], {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "search",
        input: { query: "test" },
      });
    });

    it("adds empty text for assistant message with no content", () => {
      const msg: Message = {
        id: "a3",
        role: "assistant",
        parts: [],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], { type: "text", text: "" });
    });

    it("converts a tool result message", () => {
      const msg: Message = {
        id: "t1",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { data: [1, 2, 3] },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "tool");
      const content = (result as TextGenerationRuntimeToolMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "search",
        output: { type: "json", value: { data: [1, 2, 3] } },
      });
    });

    it("handles tool result with missing toolName", () => {
      const msg: Message = {
        id: "t2",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc2",
            result: "done",
          } as Message["parts"][0],
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeToolMessage).content;
      assertEquals(content.length, 1);
      const firstPart = content[0];
      assertEquals(firstPart?.toolName, "unknown");
    });

    it("falls back to user role for unknown message roles", () => {
      const msg = {
        id: "x1",
        role: "custom" as Message["role"],
        parts: [{ type: "text", text: "fallback" }],
      } as Message;
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "user");
      assertEquals(result.content, "fallback");
    });

    it("handles tool-call type parts in assistant messages", () => {
      const msg: Message = {
        id: "a4",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: "tc-direct",
            toolName: "calc",
            args: { expr: "1+1" },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      const firstPart = content[0];
      assertEquals(content.length, 1);
      assertEquals(firstPart?.type, "tool-call");
      if (firstPart?.type !== "tool-call") {
        throw new Error("Expected tool-call content");
      }
      assertEquals(firstPart.toolName, "calc");
    });

    it("skips tool-result parts in assistant messages", () => {
      const msg: Message = {
        id: "a5",
        role: "assistant",
        parts: [
          { type: "text", text: "response" },
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "foo",
            result: "bar",
          } as Message["parts"][0],
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      const firstPart = content[0];
      assertEquals(firstPart?.type, "text");
    });
  });

  describe("convertToTextGenerationRuntimeMessages", () => {
    it("converts an array of messages", () => {
      const messages: Message[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ];
      const result = convertToTextGenerationRuntimeMessages(messages);
      assertEquals(result.length, 2);
      assertEquals(result[0]?.role, "user");
      assertEquals(result[1]?.role, "assistant");
    });

    it("returns empty array for empty input", () => {
      assertEquals(convertToTextGenerationRuntimeMessages([]), []);
    });

    it("splits multiple tool results into one provider message per tool call", () => {
      const messages: Message[] = [{
        id: "tool_batch",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "a",
            result: "r1",
          },
          {
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "b",
            result: "r2",
          },
        ],
      }];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result.length, 2);
      assertEquals(result[0], {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "a",
          output: { type: "json", value: "r1" },
        }],
      });
      assertEquals(result[1], {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc2",
          toolName: "b",
          output: { type: "json", value: "r2" },
        }],
      });
    });

    it("keeps only the latest tool result for a repeated tool call id", () => {
      const messages: Message[] = [
        {
          id: "tool_1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { files: ["old.ts"] },
          }],
        },
        {
          id: "tool_2",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { files: ["new.ts"] },
          }],
        },
      ];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result.length, 1);
      assertEquals(result[0], {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "search",
          output: { type: "json", value: { files: ["new.ts"] } },
        }],
      });
    });
  });
});
