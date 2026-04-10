import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { convertToModelMessage, convertToModelMessages } from "./model-message-converter.ts";
import type {
  ModelRuntimeAssistantMessage,
  ModelRuntimeToolMessage,
} from "./model-runtime-types.ts";
import type { Message } from "../types.ts";

describe("model-message-converter", () => {
  describe("convertToModelMessage", () => {
    it("converts a system message", () => {
      const msg: Message = {
        id: "s1",
        role: "system",
        parts: [{ type: "text", text: "You are helpful" }],
      };
      const result = convertToModelMessage(msg);
      assertEquals(result, { role: "system", content: "You are helpful" });
    });

    it("converts a user message", () => {
      const msg: Message = {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      };
      const result = convertToModelMessage(msg);
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
      const result = convertToModelMessage(msg);
      assertEquals(result, { role: "user", content: "Hello world" });
    });

    it("converts an assistant message with text", () => {
      const msg: Message = {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Sure, I can help." }],
      };
      const result = convertToModelMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as ModelRuntimeAssistantMessage).content;
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
      const result = convertToModelMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as ModelRuntimeAssistantMessage).content;
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
      const result = convertToModelMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as ModelRuntimeAssistantMessage).content;
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
      const result = convertToModelMessage(msg);
      assertEquals(result.role, "tool");
      const content = (result as ModelRuntimeToolMessage).content;
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
      const result = convertToModelMessage(msg);
      const content = (result as ModelRuntimeToolMessage).content;
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
      const result = convertToModelMessage(msg);
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
      const result = convertToModelMessage(msg);
      const content = (result as ModelRuntimeAssistantMessage).content;
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
      const result = convertToModelMessage(msg);
      const content = (result as ModelRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      const firstPart = content[0];
      assertEquals(firstPart?.type, "text");
    });
  });

  describe("convertToModelMessages", () => {
    it("converts an array of messages", () => {
      const messages: Message[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ];
      const result = convertToModelMessages(messages);
      assertEquals(result.length, 2);
      assertEquals(result[0]?.role, "user");
      assertEquals(result[1]?.role, "assistant");
    });

    it("returns empty array for empty input", () => {
      assertEquals(convertToModelMessages([]), []);
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

      const result = convertToModelMessages(messages);

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

      const result = convertToModelMessages(messages);

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
