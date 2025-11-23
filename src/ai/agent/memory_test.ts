/**
 * Memory System Tests
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";
import { createMemory } from "./memory.ts";
import type { Message } from "../types/agent.ts";

describe("Memory System", () => {
  describe("ConversationMemory", () => {
    it("should create conversation memory", () => {
      const memory = createMemory({
        type: "conversation",
        maxTokens: 4000,
      });

      assertExists(memory);
    });

    it("should add and retrieve messages", async () => {
      const memory = createMemory({
        type: "conversation",
        maxTokens: 4000,
      });

      const message: Message = {
        id: "msg1",
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      };

      await memory.add(message);

      const messages = await memory.getMessages();
      assertEquals(messages.length, 1);
      assertEquals(messages[0]!.content, "Hello");
    });

    it("should maintain message order", async () => {
      const memory = createMemory({
        type: "conversation",
        maxTokens: 4000,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "First",
        timestamp: Date.now(),
      });

      await memory.add({
        id: "msg2",
        role: "assistant",
        content: "Second",
        timestamp: Date.now(),
      });

      const messages = await memory.getMessages();
      assertEquals(messages.length, 2);
      assertEquals(messages[0]!.content, "First");
      assertEquals(messages[1]!.content, "Second");
    });

    it("should provide memory stats", async () => {
      const memory = createMemory({
        type: "conversation",
        maxTokens: 4000,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "Test message",
        timestamp: Date.now(),
      });

      const stats = await memory.getStats();
      assertEquals(stats.type, "conversation");
      assertEquals(stats.totalMessages, 1);
      assertExists(stats.estimatedTokens);
    });

    it("should clear memory", async () => {
      const memory = createMemory({
        type: "conversation",
        maxTokens: 4000,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "Test",
        timestamp: Date.now(),
      });

      await memory.clear();

      const messages = await memory.getMessages();
      assertEquals(messages.length, 0);
    });
  });

  describe("BufferMemory", () => {
    it("should create buffer memory", () => {
      const memory = createMemory({
        type: "buffer",
        maxMessages: 5,
      });

      assertExists(memory);
    });

    it("should keep only last N messages", async () => {
      const memory = createMemory({
        type: "buffer",
        maxMessages: 3,
      });

      // Add 5 messages
      for (let i = 1; i <= 5; i++) {
        await memory.add({
          id: `msg${i}`,
          role: "user",
          content: `Message ${i}`,
          timestamp: Date.now(),
        });
      }

      const messages = await memory.getMessages();

      // Should only have last 3
      assertEquals(messages.length, 3);
      assertEquals(messages[0]!.content, "Message 3");
      assertEquals(messages[1]!.content, "Message 4");
      assertEquals(messages[2]!.content, "Message 5");
    });

    it("should provide correct stats", async () => {
      const memory = createMemory({
        type: "buffer",
        maxMessages: 5,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "Test",
        timestamp: Date.now(),
      });

      const stats = await memory.getStats();
      assertEquals(stats.type, "buffer");
      assertEquals(stats.totalMessages, 1);
    });
  });

  describe("SummaryMemory", () => {
    it("should create summary memory", () => {
      const memory = createMemory({
        type: "summary",
        maxMessages: 20,
      });

      assertExists(memory);
    });

    it("should add messages", async () => {
      const memory = createMemory({
        type: "summary",
        maxMessages: 20,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "Test",
        timestamp: Date.now(),
      });

      const messages = await memory.getMessages();
      assertEquals(messages.length, 1);
    });

    it("should provide correct stats", async () => {
      const memory = createMemory({
        type: "summary",
        maxMessages: 20,
      });

      await memory.add({
        id: "msg1",
        role: "user",
        content: "Test",
        timestamp: Date.now(),
      });

      const stats = await memory.getStats();
      assertEquals(stats.type, "summary");
    });
  });
});
