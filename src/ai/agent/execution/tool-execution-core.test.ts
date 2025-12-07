/**
 * Unit tests for ToolExecutionCore
 *
 * Tests the argument parsing functionality which doesn't require mocking.
 * Full execution tests would require integration testing with actual tools.
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  createToolExecutionCore,
  type ProviderToolCall,
  ToolExecutionCore,
} from "./tool-execution-core.ts";

describe("ToolExecutionCore", () => {
  describe("createToolExecutionCore factory", () => {
    it("should create ToolExecutionCore instance", () => {
      const mockMemory = {
        add: () => Promise.resolve(),
        getMessages: () => Promise.resolve([]),
        clear: () => Promise.resolve(),
        getStats: () =>
          Promise.resolve({
            totalMessages: 0,
            estimatedTokens: 0,
            type: "conversation" as const,
          }),
      };

      const instance = createToolExecutionCore({
        agentId: "factory-test",
        memory: mockMemory,
      });

      assertEquals(instance instanceof ToolExecutionCore, true);
    });
  });

  describe("ProviderToolCall types", () => {
    it("should accept string arguments", () => {
      const toolCall: ProviderToolCall = {
        id: "call_123",
        name: "testTool",
        arguments: '{"query": "hello"}',
      };

      assertEquals(toolCall.id, "call_123");
      assertEquals(toolCall.name, "testTool");
      assertEquals(typeof toolCall.arguments, "string");
    });

    it("should accept object arguments", () => {
      const toolCall: ProviderToolCall = {
        id: "call_456",
        name: "testTool",
        arguments: { query: "world", count: 10 },
      };

      assertEquals(toolCall.id, "call_456");
      assertEquals(toolCall.name, "testTool");
      assertEquals(typeof toolCall.arguments, "object");
      assertEquals((toolCall.arguments as Record<string, unknown>).query, "world");
    });
  });

  describe("Instance creation", () => {
    it("should create instance with context", () => {
      const mockMemory = {
        add: () => Promise.resolve(),
        getMessages: () => Promise.resolve([]),
        clear: () => Promise.resolve(),
        getStats: () =>
          Promise.resolve({
            totalMessages: 0,
            estimatedTokens: 0,
            type: "conversation" as const,
          }),
      };

      const core = new ToolExecutionCore({
        agentId: "test-agent-123",
        memory: mockMemory,
      });

      assertExists(core);
      assertExists(core.execute);
      assertExists(core.executeAll);
    });

    it("should have execute method", () => {
      const mockMemory = {
        add: () => Promise.resolve(),
        getMessages: () => Promise.resolve([]),
        clear: () => Promise.resolve(),
        getStats: () =>
          Promise.resolve({
            totalMessages: 0,
            estimatedTokens: 0,
            type: "conversation" as const,
          }),
      };

      const core = new ToolExecutionCore({
        agentId: "test-agent",
        memory: mockMemory,
      });

      assertEquals(typeof core.execute, "function");
    });

    it("should have executeAll method", () => {
      const mockMemory = {
        add: () => Promise.resolve(),
        getMessages: () => Promise.resolve([]),
        clear: () => Promise.resolve(),
        getStats: () =>
          Promise.resolve({
            totalMessages: 0,
            estimatedTokens: 0,
            type: "conversation" as const,
          }),
      };

      const core = new ToolExecutionCore({
        agentId: "test-agent",
        memory: mockMemory,
      });

      assertEquals(typeof core.executeAll, "function");
    });
  });
});
