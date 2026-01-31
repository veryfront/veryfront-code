import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTextContent, groupPartsInOrder, isReasoningPart, isToolPart } from "./message-parts.ts";
import type { UIMessage, UIMessagePart } from "#veryfront/agent/react";

function makeMessage(parts: UIMessagePart[]): UIMessage {
  return { id: "msg-1", role: "user", parts };
}

describe("message-parts", () => {
  describe("getTextContent", () => {
    it("extracts text from text parts", () => {
      const message = makeMessage([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ]);

      assertEquals(getTextContent(message), "Hello world");
    });

    it("ignores non-text parts", () => {
      const message = makeMessage([
        { type: "text", text: "Hello" },
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "text", text: " there" },
      ]);

      assertEquals(getTextContent(message), "Hello there");
    });

    it("returns empty string when no text parts", () => {
      const message = makeMessage([
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
      ]);

      assertEquals(getTextContent(message), "");
    });
  });

  describe("isToolPart", () => {
    it("returns true for tool-prefixed parts", () => {
      const part: UIMessagePart = {
        type: "tool-search",
        toolCallId: "tc1",
        toolName: "search",
        state: "input-available",
        input: {},
      };

      assertEquals(isToolPart(part), true);
    });

    it("returns true for dynamic-tool parts", () => {
      const part: UIMessagePart = {
        type: "dynamic-tool",
        toolCallId: "tc1",
        toolName: "dynamic",
        state: "input-available",
      };

      assertEquals(isToolPart(part), true);
    });

    it("returns false for tool-result", () => {
      const part: UIMessagePart = { type: "tool-result" };
      assertEquals(isToolPart(part), false);
    });

    it("returns false for text parts", () => {
      const part: UIMessagePart = { type: "text", text: "hi" };
      assertEquals(isToolPart(part), false);
    });
  });

  describe("isReasoningPart", () => {
    it("returns true for reasoning parts", () => {
      const part: UIMessagePart = { type: "reasoning", text: "thinking..." };
      assertEquals(isReasoningPart(part), true);
    });

    it("returns false for text parts", () => {
      const part: UIMessagePart = { type: "text", text: "hi" };
      assertEquals(isReasoningPart(part), false);
    });
  });

  describe("groupPartsInOrder", () => {
    it("groups consecutive text parts together", () => {
      const parts: UIMessagePart[] = [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 1);

      const first = groups[0];
      assertExists(first);
      assertEquals(first.type, "text");
      assertEquals((first as { content: string }).content, "Hello world");
    });

    it("separates tool parts from text", () => {
      const parts: UIMessagePart[] = [
        { type: "text", text: "Before" },
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "text", text: "After" },
      ];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 3);

      const [first, second, third] = groups;
      assertExists(first);
      assertExists(second);
      assertExists(third);
      assertEquals(first.type, "text");
      assertEquals(second.type, "tool");
      assertEquals(third.type, "text");
    });

    it("handles reasoning parts", () => {
      const parts: UIMessagePart[] = [
        { type: "reasoning", text: "thinking...", state: "streaming" },
        { type: "text", text: "Answer" },
      ];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 2);

      const [first, second] = groups;
      assertExists(first);
      assertExists(second);
      assertEquals(first.type, "reasoning");
      assertEquals((first as { isStreaming: boolean }).isStreaming, true);
      assertEquals(second.type, "text");
    });

    it("skips tool-result parts", () => {
      const parts: UIMessagePart[] = [
        { type: "text", text: "Result: " },
        { type: "tool-result", toolCallId: "tc1", toolName: "search", result: {} },
        { type: "text", text: "done" },
      ];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 1);

      const first = groups[0];
      assertExists(first);
      assertEquals((first as { content: string }).content, "Result: done");
    });

    it("handles empty parts array", () => {
      assertEquals(groupPartsInOrder([]).length, 0);
    });
  });
});
