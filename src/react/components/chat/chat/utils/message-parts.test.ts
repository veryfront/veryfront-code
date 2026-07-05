import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAnswerPartsForRendering,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
} from "./message-parts.ts";
import type { ChatMessage, ChatMessagePart } from "#veryfront/agent/react";

function makeMessage(parts: ChatMessagePart[]): ChatMessage {
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
      const part: ChatMessagePart = {
        type: "tool-search",
        toolCallId: "tc1",
        toolName: "search",
        state: "input-available",
        input: {},
      };

      assertEquals(isToolPart(part), true);
    });

    it("returns true for dynamic-tool parts", () => {
      const part: ChatMessagePart = {
        type: "dynamic-tool",
        toolCallId: "tc1",
        toolName: "dynamic",
        state: "input-available",
      };

      assertEquals(isToolPart(part), true);
    });

    it("returns false for tool-result", () => {
      const part: ChatMessagePart = {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "search",
        result: {},
      };
      assertEquals(isToolPart(part), false);
    });

    it("returns false for text parts", () => {
      const part: ChatMessagePart = { type: "text", text: "hi" };
      assertEquals(isToolPart(part), false);
    });
  });

  describe("isReasoningPart", () => {
    it("returns true for reasoning parts", () => {
      const part: ChatMessagePart = { type: "reasoning", text: "thinking..." };
      assertEquals(isReasoningPart(part), true);
    });

    it("returns false for text parts", () => {
      const part: ChatMessagePart = { type: "text", text: "hi" };
      assertEquals(isReasoningPart(part), false);
    });
  });

  describe("groupPartsInOrder", () => {
    it("groups consecutive text parts together", () => {
      const parts: ChatMessagePart[] = [
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
      const parts: ChatMessagePart[] = [
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
      const parts: ChatMessagePart[] = [
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
      const parts: ChatMessagePart[] = [
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

    it("emits a file group for file parts, in order, without swallowing text", () => {
      const parts: ChatMessagePart[] = [
        { type: "file", mediaType: "image/png", url: "https://x/img.png", filename: "img.png" },
        { type: "text", text: "look at this" },
      ];

      const groups = groupPartsInOrder(parts);
      assertEquals(groups.length, 2, "file part and text should be separate groups");

      const [file, text] = groups;
      assertExists(file);
      assertEquals(file.type, "file", "the first group should be the file");
      assertEquals(
        (file as { file: { url: string } }).file.url,
        "https://x/img.png",
        "the file part should be carried through intact",
      );
      assertEquals((text as { content: string }).content, "look at this", "text follows the file");
    });
  });

  describe("getAnswerPartsForRendering", () => {
    it("uses the post-tool text as the assistant answer while preserving tool cards", () => {
      const parts: ChatMessagePart[] = [
        { type: "text", text: "I'll check the current queue." },
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "tool-result", toolCallId: "tc1", toolName: "search", result: {} },
        { type: "text", text: "I found one urgent incident." },
        {
          type: "tool-search",
          toolCallId: "tc2",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "tool-result", toolCallId: "tc2", toolName: "search", result: {} },
        { type: "text", text: "Selected INC-2026-0714 for triage." },
      ];

      const answerParts = getAnswerPartsForRendering(parts, { isAssistant: true });

      assertEquals(
        answerParts.map((part) => part.type),
        ["tool-search", "tool-result", "tool-search", "tool-result", "text"],
      );
      assertEquals(getTextContent(makeMessage(answerParts)), "Selected INC-2026-0714 for triage.");
    });

    it("keeps assistant progress text when no final answer exists yet", () => {
      const parts: ChatMessagePart[] = [
        { type: "text", text: "I'll inspect the incident first." },
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "tool-result", toolCallId: "tc1", toolName: "search", result: {} },
      ];

      assertEquals(getAnswerPartsForRendering(parts, { isAssistant: true }), parts);
    });

    it("does not rewrite user text around tool-shaped attachments", () => {
      const parts: ChatMessagePart[] = [
        { type: "text", text: "Use this payload." },
        {
          type: "tool-search",
          toolCallId: "tc1",
          toolName: "search",
          state: "input-available",
          input: {},
        },
        { type: "text", text: "Keep both text parts." },
      ];

      assertEquals(getAnswerPartsForRendering(parts, { isAssistant: false }), parts);
    });
  });
});
