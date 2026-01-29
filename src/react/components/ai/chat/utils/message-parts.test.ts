import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getTextContent, groupPartsInOrder, isReasoningPart, isToolPart } from "./message-parts.ts";
import type { UIMessage, UIMessagePart } from "#veryfront/agent/react";

describe("message-parts", () => {
  describe("getTextContent", () => {
    it("extracts text from text parts", () => {
      const message = {
        parts: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      } as UIMessage;
      assertEquals(getTextContent(message), "Hello world");
    });

    it("ignores non-text parts", () => {
      const message = {
        parts: [
          { type: "text", text: "Hello" },
          { type: "tool-search", toolCallId: "tc1", toolName: "search", args: {} },
          { type: "text", text: " there" },
        ],
      } as UIMessage;
      assertEquals(getTextContent(message), "Hello there");
    });

    it("returns empty string when no text parts", () => {
      const message = {
        parts: [
          { type: "tool-search", toolCallId: "tc1", toolName: "search", args: {} },
        ],
      } as UIMessage;
      assertEquals(getTextContent(message), "");
    });
  });

  describe("isToolPart", () => {
    it("returns true for tool-prefixed parts", () => {
      const part = { type: "tool-search" } as UIMessagePart;
      assertEquals(isToolPart(part), true);
    });

    it("returns true for dynamic-tool parts", () => {
      const part = { type: "dynamic-tool" } as UIMessagePart;
      assertEquals(isToolPart(part), true);
    });

    it("returns false for tool-result", () => {
      const part = { type: "tool-result" } as UIMessagePart;
      assertEquals(isToolPart(part), false);
    });

    it("returns false for text parts", () => {
      const part = { type: "text", text: "hi" } as UIMessagePart;
      assertEquals(isToolPart(part), false);
    });
  });

  describe("isReasoningPart", () => {
    it("returns true for reasoning parts", () => {
      const part = { type: "reasoning", text: "thinking..." } as UIMessagePart;
      assertEquals(isReasoningPart(part), true);
    });

    it("returns false for text parts", () => {
      const part = { type: "text", text: "hi" } as UIMessagePart;
      assertEquals(isReasoningPart(part), false);
    });
  });

  describe("groupPartsInOrder", () => {
    it("groups consecutive text parts together", () => {
      const parts = [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ] as UIMessagePart[];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 1);
      assertEquals(groups[0].type, "text");
      assertEquals((groups[0] as { content: string }).content, "Hello world");
    });

    it("separates tool parts from text", () => {
      const parts = [
        { type: "text", text: "Before" },
        { type: "tool-search", toolCallId: "tc1", toolName: "search", args: {} },
        { type: "text", text: "After" },
      ] as UIMessagePart[];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 3);
      assertEquals(groups[0].type, "text");
      assertEquals(groups[1].type, "tool");
      assertEquals(groups[2].type, "text");
    });

    it("handles reasoning parts", () => {
      const parts = [
        { type: "reasoning", text: "thinking...", state: "streaming" },
        { type: "text", text: "Answer" },
      ] as UIMessagePart[];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 2);
      assertEquals(groups[0].type, "reasoning");
      assertEquals(
        (groups[0] as { isStreaming: boolean }).isStreaming,
        true,
      );
      assertEquals(groups[1].type, "text");
    });

    it("skips tool-result parts", () => {
      const parts = [
        { type: "text", text: "Result: " },
        { type: "tool-result", toolCallId: "tc1", toolName: "search", result: {} },
        { type: "text", text: "done" },
      ] as UIMessagePart[];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 1);
      assertEquals((groups[0] as { content: string }).content, "Result: done");
    });

    it("handles empty parts array", () => {
      const groups = groupPartsInOrder([]);
      assertEquals(groups.length, 0);
    });
  });
});
