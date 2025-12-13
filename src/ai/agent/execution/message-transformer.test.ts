import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  MessageTransformer,
  createMessageTransformer,
} from "./message-transformer.ts";
import type { Message, ToolCall } from "../../types/agent.ts";

describe("MessageTransformer", () => {
  describe("toProviderFormat", () => {
    it("should convert messages to provider format", () => {
      const transformer = new MessageTransformer();
      const messages: Message[] = [
        {
          id: "msg1",
          role: "user",
          content: "Hello",
          timestamp: Date.now(),
        },
        {
          id: "msg2",
          role: "assistant",
          content: "Hi there",
          timestamp: Date.now(),
        },
      ];

      const result = transformer.toProviderFormat(messages);

      assertEquals(result.length, 2);
      assertEquals(result[0]!.role, "user");
      assertEquals(result[0]!.content, "Hello");
      assertEquals(result[1]!.role, "assistant");
      assertEquals(result[1]!.content, "Hi there");
    });

    it("should handle tool calls in assistant messages", () => {
      const transformer = new MessageTransformer();
      const messages: Message[] = [
        {
          id: "msg1",
          role: "assistant",
          content: "Using tool",
          timestamp: Date.now(),
          toolCalls: [
            {
              id: "tool1",
              name: "search",
              arguments: { query: "test" },
            },
          ],
        },
      ];

      const result = transformer.toProviderFormat(messages);

      assertEquals(result[0]!.tool_calls?.length, 1);
      assertEquals(result[0]!.tool_calls?.[0].id, "tool1");
      assertEquals(result[0]!.tool_calls?.[0].function.name, "search");
      assertEquals(
        result[0]!.tool_calls?.[0].function.arguments,
        JSON.stringify({ query: "test" }),
      );
    });

    it("should handle tool result messages", () => {
      const transformer = new MessageTransformer();
      const messages: Message[] = [
        {
          id: "tool_result",
          role: "tool",
          content: '{"result":"success"}',
          toolCallId: "tool123",
          timestamp: Date.now(),
        },
      ];

      const result = transformer.toProviderFormat(messages);

      assertEquals(result[0]!.role, "tool");
      assertEquals(result[0]!.tool_call_id, "tool123");
    });
  });

  describe("createAssistantMessage", () => {
    it("should create assistant message with text", () => {
      const transformer = new MessageTransformer();
      const message = transformer.createAssistantMessage("Response text");

      assertEquals(message.role, "assistant");
      assertEquals(message.content, "Response text");
      assertExists(message.id);
      assertExists(message.timestamp);
    });

    it("should create assistant message with tool calls", () => {
      const transformer = new MessageTransformer();
      const toolCalls = [
        {
          id: "tc1",
          name: "calculator",
          arguments: { operation: "add" },
        },
      ];

      const message = transformer.createAssistantMessage(
        "Let me calculate",
        toolCalls,
      );

      assertEquals(message.toolCalls?.length, 1);
      assertEquals(message.toolCalls![0]!.id, "tc1");
      assertEquals(message.toolCalls![0]!.name, "calculator");
    });

    it("should include step number in message ID", () => {
      const transformer = new MessageTransformer();
      const message = transformer.createAssistantMessage("Text", undefined, 5);

      assert(message.id!.includes("_5"));
    });
  });

  describe("createToolResultMessage", () => {
    it("should create tool result message", () => {
      const transformer = new MessageTransformer();
      const toolCall: ToolCall = {
        id: "tc1",
        name: "search",
        args: { query: "test" },
        status: "completed",
      };

      const message = transformer.createToolResultMessage(
        "tc1",
        { results: ["item1", "item2"] },
        toolCall,
      );

      assertEquals(message.role, "tool");
      assertEquals(message.toolCallId, "tc1");
      assertEquals(message.content, '{"results":["item1","item2"]}');
      assertEquals(message.toolCall, toolCall);
    });
  });

  describe("createToolErrorMessage", () => {
    it("should create tool error message", () => {
      const transformer = new MessageTransformer();
      const toolCall: ToolCall = {
        id: "tc1",
        name: "broken_tool",
        args: {},
        status: "error",
      };

      const message = transformer.createToolErrorMessage(
        "tc1",
        "Tool execution failed",
        toolCall,
      );

      assertEquals(message.role, "tool");
      assertEquals(message.toolCallId, "tc1");
      assertEquals(message.content, "Error: Tool execution failed");
      assertEquals(message.toolCall, toolCall);
    });
  });

  describe("createUserMessage", () => {
    it("should create user message", () => {
      const transformer = new MessageTransformer();
      const message = transformer.createUserMessage("User input");

      assertEquals(message.role, "user");
      assertEquals(message.content, "User input");
      assertExists(message.id);
      assertExists(message.timestamp);
    });
  });

  describe("normalizeInput", () => {
    it("should convert string to message array", () => {
      const transformer = new MessageTransformer();
      const result = transformer.normalizeInput("Hello");

      assertEquals(result.length, 1);
      assertEquals(result[0]!.role, "user");
      assertEquals(result[0]!.content, "Hello");
    });

    it("should normalize existing messages", () => {
      const transformer = new MessageTransformer();
      const messages: Message[] = [
        {
          id: "",
          role: "user",
          content: "Test",
          timestamp: 0,
        },
      ];

      const result = transformer.normalizeInput(messages);

      assertEquals(result.length, 1);
      assertExists(result[0]!.id);
      assert(result[0]!.timestamp > 0);
    });

    it("should preserve existing message properties", () => {
      const transformer = new MessageTransformer();
      const messages: Message[] = [
        {
          id: "existing_id",
          role: "user",
          content: "Test",
          timestamp: 123456,
        },
      ];

      const result = transformer.normalizeInput(messages);

      assertEquals(result[0]!.id, "existing_id");
      assertEquals(result[0]!.timestamp, 123456);
    });
  });

  describe("createMessageTransformer", () => {
    it("should create a new MessageTransformer instance", () => {
      const transformer = createMessageTransformer();
      assertExists(transformer);
      assertEquals(transformer instanceof MessageTransformer, true);
    });
  });
});

function assert(condition: boolean): void {
  if (!condition) {
    throw new Error("Assertion failed");
  }
}
